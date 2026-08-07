"""Survey Analytics Pipeline Orchestrator.

This script executes as a standalone Google Cloud Run Job container to coordinate
the heavy data extraction, Gemini topic categorization, text summarization, and
offline D3 visualization compilation for survey datasets.
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

import google.auth
from google.cloud import firestore, storage

# Set path to workspace root so upstream 'src' modules can be imported
workspace_root = os.path.abspath(os.path.dirname(__file__))
if workspace_root not in sys.path:
    sys.path.insert(0, workspace_root)

from src import categorization_runner
from src import checkpoint_utils
from src.generate_report_text import generate_report_text

_LAST_TELEMETRY_UPDATE: float = 0.0


def setup_logging(log_level: str, output_dir: str) -> str:
    """Initializes standard logging handlers for container stdout and file logs.

    Args:
        log_level: Logging verbosity level (e.g., 'INFO', 'DEBUG').
        output_dir: Local directory path where log files will be persisted.

    Returns:
        The absolute path to the initialized logs directory.
    """
    os.makedirs(output_dir, exist_ok=True)
    log_dir = os.path.join(output_dir, "logs")
    os.makedirs(log_dir, exist_ok=True)

    # Reset any existing root handlers to avoid duplicate log entries
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)

    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logging.info("Logging initialized. Output dir: %s", output_dir)
    return log_dir


def update_telemetry(
    db: Optional[firestore.Client],
    survey_slug: str,
    status_msg: str,
    is_complete: bool = False,
) -> None:
    """Publishes real-time pipeline execution progress to Firestore.

    Throttles updates to a minimum interval of 1.5 seconds to adhere to
    Firestore's 1-write-per-second per-document rate limits.

    Args:
        db: Initialized Firestore client.
        survey_slug: Document ID slug for the target survey.
        status_msg: Human-readable status message for the admin UI.
        is_complete: Boolean indicating whether the pipeline execution has finished.
    """
    global _LAST_TELEMETRY_UPDATE
    if not db or not survey_slug:
        return

    now = time.time()
    elapsed = now - _LAST_TELEMETRY_UPDATE
    if elapsed < 1.5:
        if not is_complete:
            logging.info("Throttling telemetry update (too fast): %s", status_msg)
            return
        else:
            sleep_time = 1.5 - elapsed
            logging.info(
                "Sleeping %.2fs to satisfy Firestore document write limits for completion signal.",
                sleep_time,
            )
            time.sleep(sleep_time)

    try:
        telemetry_payload = {
            "telemetry": {
                "status": status_msg,
                "is_complete": is_complete,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "execution_name": os.environ.get("CLOUD_RUN_EXECUTION", ""),
            }
        }
        db.collection("surveys").document(survey_slug).collection("admin").document("metadata").set(
            telemetry_payload, merge=True
        )
        logging.info("[TELEMETRY] %s", status_msg)
        _LAST_TELEMETRY_UPDATE = time.time()
    except Exception as e:
        logging.warning("Failed to update Firestore telemetry: %s", e)


class TelemetryHeartbeat:
    """Background daemon thread that periodically refreshes Firestore telemetry.

    Prevents long-running Gemini categorization steps from triggering the frontend's
    15-minute zombie detection threshold. Also inspects intermediate checkpoint
    files to publish granular sub-step progress updates.
    """

    def __init__(
        self,
        db: firestore.Client,
        survey_slug: str,
        output_dir: str,
        skip_quote_extraction: bool = False,
        skip_autoraters: bool = False,
        interval_seconds: int = 60,
    ):
        """Initializes the telemetry heartbeat daemon.

        Args:
            db: Initialized Firestore client.
            survey_slug: Document ID slug for the target survey.
            output_dir: Output directory containing .checkpoints/.
            skip_quote_extraction: Whether quote extraction is disabled.
            skip_autoraters: Whether autorater evaluation is disabled.
            interval_seconds: Polling and refresh frequency in seconds.
        """
        self.db = db
        self.survey_slug = survey_slug
        self.output_dir = output_dir
        self.skip_quote_extraction = skip_quote_extraction
        self.skip_autoraters = skip_autoraters
        self.interval_seconds = interval_seconds
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._current_step = ""
        self._in_categorization = False

    def set_step(self, step_msg: str, in_categorization: bool = False) -> None:
        """Updates the active pipeline step description.

        Args:
            step_msg: Active phase description text.
            in_categorization: Whether the pipeline is currently in categorization.
        """
        self._current_step = step_msg
        self._in_categorization = in_categorization
        update_telemetry(self.db, self.survey_slug, step_msg)

    def _get_categorization_progress_msg(self) -> str:
        """Inspects disk checkpoints to construct fine-grained categorization progress text."""
        checkpoint_dir = os.path.join(self.output_dir, ".checkpoints")
        if not os.path.exists(checkpoint_dir):
            return "Categorizing: modeling topics..."

        if os.path.exists(os.path.join(checkpoint_dir, "statements_with_topics_and_learned_topics.pkl")):
            if not self.skip_quote_extraction and not os.path.exists(
                os.path.join(checkpoint_dir, "statements_with_quotes.pkl")
            ):
                return "Categorizing: extracting quotes..."
            elif not os.path.exists(os.path.join(checkpoint_dir, "statements_with_opinions.pkl")):
                return "Categorizing: identifying opinions..."
            elif not self.skip_autoraters and not os.path.exists(
                os.path.join(checkpoint_dir, "statements_with_autorater_scores.pkl")
            ):
                return "Categorizing: evaluating output..."
            else:
                return "Categorizing: finalizing output..."
        return "Categorizing: modeling topics..."

    def start(self) -> None:
        """Spawns and starts the background heartbeat thread."""
        def _run():
            while not self._stop_event.wait(self.interval_seconds):
                if self._in_categorization:
                    msg = self._get_categorization_progress_msg()
                    update_telemetry(self.db, self.survey_slug, msg)
                elif self._current_step:
                    update_telemetry(self.db, self.survey_slug, self._current_step)

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Signals the background thread to terminate and waits for join."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)


def sync_state_from_bucket(bucket: storage.Bucket, survey_slug: str, output_dir: str) -> None:
    """Restores intermediate checkpoints and payloads from Cloud Storage to local disk.

    Args:
        bucket: Initialized Google Cloud Storage bucket.
        survey_slug: Document ID slug for the target survey.
        output_dir: Local output directory destination.
    """
    prefix = f"reports/{survey_slug}/data/"
    blobs = list(bucket.list_blobs(prefix=prefix))
    count = 0
    for blob in blobs:
        relative_path = blob.name[len(prefix):]
        if not relative_path or relative_path.endswith("/"):
            continue
        local_path = os.path.join(output_dir, relative_path)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        blob.download_to_filename(local_path)
        logging.info("Downloaded state file: %s", relative_path)
        count += 1
    if count > 0:
        logging.info("Restored %d existing intermediate/checkpoint files from Cloud Storage.", count)


def sync_state_to_bucket(
    bucket: storage.Bucket,
    survey_slug: str,
    output_dir: str,
    admin_ref: firestore.DocumentReference,
) -> None:
    """Synchronizes intermediate files to Cloud Storage and registers URLs in Firestore.

    Args:
        bucket: Initialized Google Cloud Storage bucket.
        survey_slug: Document ID slug for the target survey.
        output_dir: Local output directory source.
        admin_ref: Document reference to surveys/{slug}/admin/metadata.
    """
    prefix = f"reports/{survey_slug}/data/"
    uploaded_urls = []

    files_to_check = [
        "input.csv",
        "categorized_with_other_filtered.csv",
        "report_data_with_opinions.json",
    ]

    checkpoints_dir = os.path.join(output_dir, ".checkpoints")
    if os.path.exists(checkpoints_dir):
        for f in os.listdir(checkpoints_dir):
            if f.endswith(".pkl"):
                files_to_check.append(os.path.join(".checkpoints", f))

    for relative_path in files_to_check:
        local_path = os.path.join(output_dir, relative_path)
        if os.path.exists(local_path):
            blob_path = f"{prefix}{relative_path}"
            blob = bucket.blob(blob_path)
            blob.upload_from_filename(local_path)
            logging.info("Uploaded state file: %s", relative_path)
            if not relative_path.startswith(".checkpoints"):
                uploaded_urls.append(f"gs://{bucket.name}/{blob_path}")

    if uploaded_urls:
        try:
            admin_ref.set({"intermediate_files": firestore.ArrayUnion(uploaded_urls)}, merge=True)
            logging.info("Registered intermediate file URIs in Firestore metadata.")
        except Exception as e:
            logging.warning("Failed to update admin metadata document with intermediate files: %s", e)


def run_subprocess_command(args: List[str], cwd: str) -> bool:
    """Executes a subprocess command, streams stdout/stderr to logging, and validates exit code.

    Args:
        args: Command-line argument list.
        cwd: Working directory for execution.

    Returns:
        True if the command succeeded with return code 0; False otherwise.
    """
    logging.info("Running command: %s in %s", " ".join(args), cwd)
    try:
        with subprocess.Popen(
            args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        ) as p:
            for line in iter(p.stdout.readline, ""):
                if line:
                    logging.info("[subprocess] %s", line.strip())
            returncode = p.wait()

        if returncode != 0:
            logging.error("Command failed with return code %d", returncode)
            return False

        logging.info("Command completed successfully.")
        return True
    except Exception as e:
        logging.error("Failed to run subprocess command: %s", e)
        return False


def main() -> None:
    """Main orchestrator routine parsing arguments and driving the 6-phase pipeline."""
    # =========================================================================
    # Phase 0: CLI Parsing & Environment Setup
    # =========================================================================
    parser = argparse.ArgumentParser(description="Orchestrate Survey Analytics Pipeline.")
    parser.add_argument("-s", "--survey_slug", required=True, help="Survey Document Slug to process.")
    parser.add_argument("-o", "--output_dir", required=True, help="Path to output directory.")
    parser.add_argument("--model_name", default="gemini-3.5-flash", help="AI Model Name.")
    parser.add_argument("--log_level", default="INFO", help="Logging level.")
    parser.add_argument("--project_id", default=None, help="Force GCP Project ID.")
    parser.add_argument("--additional_context", type=str, default=None, help="Additional context prompt.")
    parser.add_argument("--topics", type=str, default=None, help="Comma separated topics list.")
    parser.add_argument("--skip_autoraters", action="store_true", help="Skip autorater evaluation passes.")
    parser.add_argument("--skip_quote_extraction", action="store_true", help="Skip quote extraction passes.")

    args = parser.parse_args()
    setup_logging(args.log_level, args.output_dir)

    logging.info("Starting Survey Analytics Orchestrator for slug: %s", args.survey_slug)
    logging.info(
        "Pipeline Configuration: model=%s, skip_autoraters=%s, skip_quote_extraction=%s, topics_specified=%s",
        args.model_name,
        args.skip_autoraters,
        args.skip_quote_extraction,
        bool(args.topics),
    )
    heartbeat: Optional[TelemetryHeartbeat] = None

    try:
        # Initialize Google Cloud Clients
        db = firestore.Client(project=args.project_id, database="standalone")
        stor = storage.Client(project=args.project_id)
        if not args.project_id:
            _, project_id = google.auth.default()
        else:
            project_id = args.project_id
        default_bucket_name = f"{project_id}.appspot.com"
        bucket = stor.bucket(default_bucket_name)
    except Exception as e:
        logging.error("Failed to initialize Google Cloud clients: %s", e)
        sys.exit(1)

    try:
        # =====================================================================
        # Phase 1: Survey Validation & Cancellation Pre-check
        # =====================================================================
        survey_ref = db.collection("surveys").document(args.survey_slug)
        doc = survey_ref.get()
        if not doc.exists:
            logging.error("Survey document '%s' does not exist in Firestore.", args.survey_slug)
            update_telemetry(db, args.survey_slug, "Failed: Survey document does not exist.", is_complete=True)
            sys.exit(1)

        admin_ref = survey_ref.collection("admin").document("metadata")
        admin_doc = admin_ref.get()
        admin_data = admin_doc.to_dict() or {} if admin_doc.exists else {}

        telemetry_data = admin_data.get("telemetry", {})
        status_text = str(telemetry_data.get("status", "")).lower()
        if "cancel" in status_text or admin_data.get("cancel_requested"):
            logging.info("Pipeline cancellation detected at startup. Aborting immediately.")
            sys.exit(0)

        survey_data = doc.to_dict() or {}
        survey_type = survey_data.get("type", "integrated")
        input_csv_path = os.path.join(args.output_dir, "input.csv")

        update_telemetry(db, args.survey_slug, "Initializing pipeline...")

        # =====================================================================
        # Phase 2: State Restoration from Cloud Storage
        # =====================================================================
        sync_state_from_bucket(bucket, args.survey_slug, args.output_dir)

        # =====================================================================
        # Phase 3: Data Ingestion & Input CSV Preparation
        # =====================================================================
        ste_name_prep = "data_preparation_done"
        if checkpoint_utils.load_checkpoint(ste_name_prep, args.output_dir):
            logging.info("Step 0: Data prep already completed. Skipping.")
        else:
            logging.info("Step 0: Preparing data for mode: %s", survey_type)
            if survey_type == "integrated":
                responses = db.collection("surveys").document(args.survey_slug).collection("responses").stream()

                rows_written = 0
                with open(input_csv_path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=["participant_id", "survey_text"])
                    writer.writeheader()

                    for r in responses:
                        r_data = r.to_dict()
                        answers = r_data.get("answers", {})
                        valid_answers = []
                        if isinstance(answers, dict):
                            for k in sorted(answers.keys(), key=lambda x: (0, int(x)) if str(x).isdigit() else (1, str(x))):
                                ans_obj = answers[k]
                                if isinstance(ans_obj, dict):
                                    if ans_obj.get("answer"):
                                        valid_answers.append(str(ans_obj["answer"]).strip())
                                    if ans_obj.get("followUpAnswer"):
                                        valid_answers.append(str(ans_obj["followUpAnswer"]).strip())
                                elif isinstance(ans_obj, str):
                                    valid_answers.append(ans_obj.strip())
                        elif isinstance(answers, list):
                            valid_answers = [str(a).strip() for a in answers if str(a).strip()]

                        valid_answers = [a for a in valid_answers if a]
                        survey_text = " ".join(valid_answers)

                        if survey_text:
                            writer.writerow({
                                "participant_id": r.id,
                                "survey_text": survey_text,
                            })
                            rows_written += 1

                if rows_written == 0:
                    logging.error("No responses found for integrated survey.")
                    update_telemetry(db, args.survey_slug, "Failed: No responses found", is_complete=True)
                    sys.exit(1)
            elif survey_type == "uploaded":
                file_uri = admin_data.get("file_uri")
                if not file_uri or not file_uri.startswith("gs://"):
                    logging.error("Invalid file_uri for uploaded mode: %s", file_uri)
                    update_telemetry(db, args.survey_slug, f"Failed: Invalid file_uri: {file_uri}", is_complete=True)
                    sys.exit(1)
                source_bucket_name = file_uri.split("/")[2]
                blob_name = "/".join(file_uri.split("/")[3:])
                source_bucket = stor.bucket(source_bucket_name)
                blob = source_bucket.blob(blob_name)
                blob.download_to_filename(input_csv_path)

            checkpoint_utils.save_checkpoint(True, ste_name_prep, args.output_dir)
            sync_state_to_bucket(bucket, args.survey_slug, args.output_dir, admin_ref)

        # =====================================================================
        # Phase 4: Unsupervised Categorization & Topic Modeling
        # =====================================================================
        heartbeat = TelemetryHeartbeat(
            db=db,
            survey_slug=args.survey_slug,
            output_dir=args.output_dir,
            skip_quote_extraction=args.skip_quote_extraction,
            skip_autoraters=args.skip_autoraters,
            interval_seconds=60,
        )
        heartbeat.start()
        heartbeat.set_step("Categorizing: modeling topics...", in_categorization=True)
        ste_name_cat = "categorization_done"
        checkpoint_cat = checkpoint_utils.load_checkpoint(ste_name_cat, args.output_dir)

        if checkpoint_cat:
            logging.info("Step 1: Categorization already completed. Skipping.")
        else:
            logging.info("Step 1: Running Categorization...")
            cmd = [
                "categorization_runner",
                "--output_dir", args.output_dir,
                "--input_file", input_csv_path,
                "--model_name", args.model_name,
            ]
            if args.additional_context:
                cmd.extend(["--additional_context", args.additional_context])
            if args.topics:
                cmd.extend(["--topics", args.topics])
            if args.skip_autoraters:
                cmd.append("--skip_autoraters")
            if args.skip_quote_extraction:
                cmd.append("--skip_quote_extraction")

            old_argv = sys.argv
            sys.argv = cmd
            try:
                asyncio.run(categorization_runner.main())
            except Exception as e:
                update_telemetry(db, args.survey_slug, f"Failed during Categorization: {e}", is_complete=True)
                sys.exit(1)
            finally:
                sys.argv = old_argv

            checkpoint_utils.save_checkpoint(True, ste_name_cat, args.output_dir)
            sync_state_to_bucket(bucket, args.survey_slug, args.output_dir, admin_ref)

        # =====================================================================
        # Phase 5: Gemini Report Text Generation & Summarization
        # =====================================================================
        if heartbeat:
            heartbeat.set_step("Drafting report...", in_categorization=False)
        else:
            update_telemetry(db, args.survey_slug, "Drafting report...")
        ste_name_rep = "report_generation_done"
        checkpoint_rep = checkpoint_utils.load_checkpoint(ste_name_rep, args.output_dir)

        if checkpoint_rep:
            logging.info("Step 2: Report generation already completed. Skipping.")
        else:
            logging.info("Step 2: Running Report Generation...")
            cat_file = os.path.join(args.output_dir, "categorized_with_other_filtered.csv")

            if not os.path.exists(cat_file):
                logging.error("Cannot find categorized file: %s", cat_file)
                update_telemetry(db, args.survey_slug, f"Failed: Cannot find categorized file: {cat_file}", is_complete=True)
                sys.exit(1)

            cmd = [
                "generate_report_text",
                "--input_csv", cat_file,
                "--output_dir", args.output_dir,
                "--model_name", args.model_name,
            ]
            if args.additional_context:
                cmd.extend(["--additional_context", args.additional_context])

            old_argv = sys.argv
            sys.argv = cmd
            try:
                asyncio.run(generate_report_text.main())
            except Exception as e:
                update_telemetry(db, args.survey_slug, f"Failed during Report Generation: {e}", is_complete=True)
                sys.exit(1)
            finally:
                sys.argv = old_argv

            checkpoint_utils.save_checkpoint(True, ste_name_rep, args.output_dir)
            sync_state_to_bucket(bucket, args.survey_slug, args.output_dir, admin_ref)

        # =====================================================================
        # Phase 6: Standalone D3 Visualization Bundling (Node Sandbox)
        # =====================================================================
        if heartbeat:
            heartbeat.set_step("Building interactive layout...", in_categorization=False)
        else:
            update_telemetry(db, args.survey_slug, "Building interactive layout...")
        ste_name_html = "html_generation_done"
        checkpoint_html = checkpoint_utils.load_checkpoint(ste_name_html, args.output_dir)

        final_html = os.path.join(args.output_dir, "report.html")

        if checkpoint_html and os.path.exists(final_html):
            logging.info("Step 3: HTML generation already completed. Skipping.")
        else:
            logging.info("Step 3: Running HTML Generation via Node Sandbox...")
            report_ui_src = os.path.join(workspace_root, "src", "report_ui")
            sandbox_dir = os.path.join(args.output_dir, ".build_workspace")

            if os.path.exists(sandbox_dir):
                shutil.rmtree(sandbox_dir)

            # Copy template to isolated build directory and symlink node_modules
            shutil.copytree(report_ui_src, sandbox_dir, ignore=shutil.ignore_patterns("node_modules"))
            os.symlink(os.path.join(report_ui_src, "node_modules"), os.path.join(sandbox_dir, "node_modules"))
            sandbox_input_dir = os.path.join(sandbox_dir, "input")
            os.makedirs(sandbox_input_dir, exist_ok=True)

            opinions_src = os.path.join(args.output_dir, "categorized_with_other_filtered.csv")
            summary_src = os.path.join(args.output_dir, "report_data_with_opinions.json")

            shutil.copy(opinions_src, os.path.join(sandbox_input_dir, "opinions.csv"))
            shutil.copy(summary_src, os.path.join(sandbox_input_dir, "summary.json"))

            # Populate UI layout configuration overrides
            config_payload = {
                "title": survey_data.get("title", survey_data.get("name", "Survey Results")),
                "overview_chart": admin_data.get("overview_chart", "toggle"),
                "excludedTopics": admin_data.get("excludedTopics", []),
                "excludedOpinions": admin_data.get("excludedOpinions", []),
                "number_of_top_opinions": admin_data.get("number_of_top_opinions", 10),
                "number_of_sample_quotes": admin_data.get("number_of_sample_quotes", 4),
            }
            if "logo" in admin_data and admin_data["logo"]:
                config_payload["logo"] = admin_data["logo"]

            config_path = os.path.join(sandbox_input_dir, "config.json")
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config_payload, f)

            success = run_subprocess_command(["npm", "run", "inline"], sandbox_dir)
            if not success:
                update_telemetry(db, args.survey_slug, "Failed: report build failed", is_complete=True)
                sys.exit(1)

            produced_html = os.path.join(sandbox_dir, "output", "inline", "index.html")

            if os.path.exists(produced_html):
                shutil.copy(produced_html, final_html)
                checkpoint_utils.save_checkpoint(True, ste_name_html, args.output_dir)
                shutil.rmtree(sandbox_dir)
            else:
                logging.error("Expected generated HTML at %s but not found.", produced_html)
                update_telemetry(db, args.survey_slug, "Failed: HTML verification failed", is_complete=True)
                sys.exit(1)

        # =====================================================================
        # Phase 7: Cloud Storage Publication & Telemetry Completion
        # =====================================================================
        if heartbeat:
            heartbeat.set_step("Publishing report to Cloud Storage...", in_categorization=False)
        else:
            update_telemetry(db, args.survey_slug, "Publishing report to Cloud Storage...")

        try:
            bucket = stor.bucket(default_bucket_name)
            blob_path = f"reports/{args.survey_slug}/report.html"
            blob = bucket.blob(blob_path)
            # Inject Firebase download token metadata to allow authorized direct downloads
            download_token = str(uuid.uuid4())
            blob.metadata = {"firebaseStorageDownloadTokens": download_token}
            blob.upload_from_filename(final_html, content_type="text/html")
            gs_url = f"gs://{default_bucket_name}/{blob_path}"

            admin_ref.set({"report_url": gs_url}, merge=True)
            logging.info("Deployed report to %s", gs_url)
        except Exception as e:
            logging.error("Failed to upload report to Cloud Storage: %s", e)
            update_telemetry(db, args.survey_slug, "Failed to publish report", is_complete=True)
            sys.exit(1)

        if heartbeat:
            heartbeat.stop()
        update_telemetry(db, args.survey_slug, "Complete", is_complete=True)
        logging.info("Survey Analytics Pipeline Finished Successfully!")

    except Exception as e:
        logging.error("Fatal error in analytics pipeline: %s", e, exc_info=True)
        update_telemetry(db, args.survey_slug, f"Failed: {e}", is_complete=True)
        sys.exit(1)
    finally:
        if "heartbeat" in locals() and heartbeat:
            heartbeat.stop()
        if os.path.exists(args.output_dir):
            shutil.rmtree(args.output_dir, ignore_errors=True)
            logging.info("Cleaned up temporary output directory: %s", args.output_dir)


if __name__ == "__main__":
    main()
