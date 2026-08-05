import argparse
import asyncio
import csv
import subprocess
import logging
import os
import shutil
import sys
import json
import time
import threading
import google.auth
from typing import List

# Import cloud clients
from google.cloud import firestore, storage

# Set path to workspace root so we can import 'src'
workspace_root = os.path.abspath(os.path.dirname(__file__))
if workspace_root not in sys.path:
    sys.path.insert(0, workspace_root)

from src import checkpoint_utils
from src import categorization_runner
from src.generate_report_text import generate_report_text

def setup_logging(log_level: str, output_dir: str) -> str:
    """Sets up logging for the orchestrator."""
    os.makedirs(output_dir, exist_ok=True)
    log_dir = os.path.join(output_dir, "logs")
    os.makedirs(log_dir, exist_ok=True)
    
    # Reset logging handlers to avoid duplicates
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
        
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )
    logging.info(f"Logging initialized. Output dir: {output_dir}")
    return log_dir

_LAST_TELEMETRY_UPDATE = 0.0

def update_telemetry(db, survey_slug: str, status_msg: str, is_complete: bool = False):
    """Pushes live progress updates straight to the UI."""
    global _LAST_TELEMETRY_UPDATE
    if not db or not survey_slug: return
    
    # Throttle to avoid hitting Firestore's 1-write-per-second limit
    now = time.time()
    elapsed = now - _LAST_TELEMETRY_UPDATE
    if elapsed < 1.5:
        if not is_complete:
            logging.info(f"Skipping telemetry update (too fast): {status_msg}")
            return
        else:
            sleep_time = 1.5 - elapsed
            logging.info(f"Sleeping {sleep_time:.2f}s to avoid Firestore rate limit for final update.")
            time.sleep(sleep_time)
            
    try:
        db.collection("surveys").document(survey_slug).collection("admin").document("metadata").set(
            {
                "telemetry": {
                    "status": status_msg,
                    "is_complete": is_complete,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "execution_name": os.environ.get("CLOUD_RUN_EXECUTION", "")
                }
            }, 
            merge=True
        )
        logging.info(f"[TELEMETRY] {status_msg}")
        _LAST_TELEMETRY_UPDATE = time.time()
    except Exception as e:
        logging.warning(f"Failed to update telemetry: {e}")

class TelemetryHeartbeat:
    """Background daemon thread that periodically updates Firestore telemetry
    so long-running steps don't appear as FAILED_ZOMBIE in the UI.
    Also inspects checkpoint files during categorization to provide accurate progress.
    """
    def __init__(self, db, survey_slug: str, output_dir: str, skip_quote_extraction: bool = False, skip_autoraters: bool = False, interval_seconds: int = 60):
        self.db = db
        self.survey_slug = survey_slug
        self.output_dir = output_dir
        self.skip_quote_extraction = skip_quote_extraction
        self.skip_autoraters = skip_autoraters
        self.interval_seconds = interval_seconds
        self._stop_event = threading.Event()
        self._thread = None
        self._current_step = ""
        self._in_categorization = False

    def set_step(self, step_msg: str, in_categorization: bool = False):
        self._current_step = step_msg
        self._in_categorization = in_categorization
        update_telemetry(self.db, self.survey_slug, step_msg)

    def _get_categorization_progress_msg(self) -> str:
        checkpoint_dir = os.path.join(self.output_dir, ".checkpoints")
        if not os.path.exists(checkpoint_dir):
            return "Categorizing: modeling topics..."
        
        if os.path.exists(os.path.join(checkpoint_dir, "statements_with_topics_and_learned_topics.pkl")):
            if not self.skip_quote_extraction and not os.path.exists(os.path.join(checkpoint_dir, "statements_with_quotes.pkl")):
                return "Categorizing: extracting quotes..."
            elif not os.path.exists(os.path.join(checkpoint_dir, "statements_with_opinions.pkl")):
                return "Categorizing: identifying opinions..."
            elif not self.skip_autoraters and not os.path.exists(os.path.join(checkpoint_dir, "statements_with_autorater_scores.pkl")):
                return "Categorizing: evaluating output..."
            else:
                return "Categorizing: finalizing output..."
        return "Categorizing: modeling topics..."

    def start(self):
        def _run():
            while not self._stop_event.wait(self.interval_seconds):
                if self._in_categorization:
                    msg = self._get_categorization_progress_msg()
                    update_telemetry(self.db, self.survey_slug, msg)
                elif self._current_step:
                    update_telemetry(self.db, self.survey_slug, self._current_step)
        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

def sync_state_from_bucket(bucket, survey_slug: str, output_dir: str):
    """Pulls existing checkpoints and intermediate files from GCS to local output_dir."""
    prefix = f"reports/{survey_slug}/data/"
    blobs = list(bucket.list_blobs(prefix=prefix))
    count = 0
    for blob in blobs:
        relative_path = blob.name[len(prefix):]
        if not relative_path or relative_path.endswith('/'): continue
        local_path = os.path.join(output_dir, relative_path)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        blob.download_to_filename(local_path)
        logging.info(f"Downloaded state file: {relative_path}")
        count += 1
    if count > 0:
        logging.info(f"Pulled {count} existing intermediate/checkpoint files from Cloud Storage.")

def sync_state_to_bucket(bucket, survey_slug: str, output_dir: str, admin_ref):
    """Pushes intermediate files to GCS and updates Firestore with their URLs."""
    prefix = f"reports/{survey_slug}/data/"
    uploaded_urls = []
    
    files_to_check = [
        "input.csv",
        "categorized_with_other_filtered.csv",
        "report_data_with_opinions.json"
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
            logging.info(f"Uploaded state file: {relative_path}")
            if not relative_path.startswith(".checkpoints"):
                uploaded_urls.append(f"gs://{bucket.name}/{blob_path}")
                
    if uploaded_urls:
        try:
            admin_ref.set({"intermediate_files": firestore.ArrayUnion(uploaded_urls)}, merge=True)
            logging.info("Pushed intermediate files to Cloud Storage.")
        except Exception as e:
            logging.warning(f"Failed to update admin metadata document with intermediate files: {e}")

def run_subprocess_command(args: List[str], cwd: str) -> bool:
    """Runs a subprocess command and handles output."""
    logging.info(f"Running command: {' '.join(args)} in {cwd}")
    
    try:
        with subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as p:
            for line in iter(p.stdout.readline, ''):
                if line: logging.info(f"[subprocess] {line.strip()}")
            returncode = p.wait()
            
        if returncode != 0:
            logging.error(f"Command failed with return code {returncode}")
            return False
            
        logging.info("Command completed successfully.")
        return True
    except Exception as e:
        logging.error(f"Failed to run command: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Orchestrate Survey Analytics Pipeline.")
    parser.add_argument("-s", "--survey_slug", required=True, help="Survey Document Slug to process.")
    parser.add_argument("-o", "--output_dir", required=True, help="Path to output directory.")
    parser.add_argument("--model_name", default="gemini-3.5-flash", help="AI Model Name.")
    parser.add_argument("--log_level", default="INFO", help="Logging level.")
    parser.add_argument("--project_id", default=None, help="Force GCP Project ID.")
    parser.add_argument("--additional_context", type=str, default=None, help="Additional context.")
    parser.add_argument("--topics", type=str, default=None, help="Comma separated topics.")
    parser.add_argument("--skip_autoraters", action="store_true", help="Skip autoraters.")
    parser.add_argument("--skip_quote_extraction", action="store_true", help="Skip quote extraction.")
    
    args = parser.parse_args()
    log_dir = setup_logging(args.log_level, args.output_dir)
    
    logging.info(f"Starting Survey Analytics Orchestrator for slug: {args.survey_slug}")
    logging.info(f"Pipeline Config: model={args.model_name}, skip_autoraters={args.skip_autoraters}, skip_quote_extraction={args.skip_quote_extraction}, topics_specified={bool(args.topics)}")
    heartbeat = None
    
    # 0. Connect to GCP and Prep Data
    try:
        db = firestore.Client(project=args.project_id, database="standalone")
        stor = storage.Client(project=args.project_id)
        if not args.project_id:
            # Derive project id for bucket
            _, project_id = google.auth.default()
        else:
            project_id = args.project_id
        default_bucket_name = f"{project_id}.appspot.com"
        bucket = stor.bucket(default_bucket_name)

    except Exception as e:
        logging.error(f"Failed to initialize Google Cloud clients: {e}")
        sys.exit(1)
        
    try:
        survey_ref = db.collection("surveys").document(args.survey_slug)
        doc = survey_ref.get()
        if not doc.exists:
            logging.error(f"Survey document {args.survey_slug} does not exist.")
            update_telemetry(db, args.survey_slug, f"Failed: Survey document does not exist.", is_complete=True)
            sys.exit(1)
            
        admin_ref = survey_ref.collection("admin").document("metadata")
        admin_doc = admin_ref.get()
        admin_data = admin_doc.to_dict() or {} if admin_doc.exists else {}
        
        survey_data = doc.to_dict() or {}
        survey_type = survey_data.get("type", "integrated")
        input_csv_path = os.path.join(args.output_dir, "input.csv")
    
        update_telemetry(db, args.survey_slug, "Initializing pipeline...")
    
        # 0.5 Sync State
        sync_state_from_bucket(bucket, args.survey_slug, args.output_dir)
    
        ste_name_prep = "data_preparation_done"
        if checkpoint_utils.load_checkpoint(ste_name_prep, args.output_dir):
            logging.info("Step 0: Data prep already completed. Skipping.")
        else:
            logging.info(f"Step 0: Preparing data for mode: {survey_type}")
            if survey_type == "integrated":
                responses = db.collection("surveys").document(args.survey_slug).collection("responses").stream()
                
                rows_written = 0
                with open(input_csv_path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=["participant_id", "survey_text"])
                    writer.writeheader()
                    
                    for r in responses:
                        r_data = r.to_dict()
                        # Concat answers while explicitly filtering out purely whitespace or empty submissions
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
                                "survey_text": survey_text
                            })
                            rows_written += 1
                            
                if rows_written == 0:
                    logging.error("No responses found for integrated survey.")
                    update_telemetry(db, args.survey_slug, "Failed: No responses found", is_complete=True)
                    sys.exit(1)
            elif survey_type == "uploaded":
                file_uri = admin_data.get("file_uri")
                if not file_uri or not file_uri.startswith("gs://"):
                    logging.error(f"Invalid file_uri for uploaded mode: {file_uri}")
                    update_telemetry(db, args.survey_slug, f"Failed: Invalid file_uri: {file_uri}", is_complete=True)
                    sys.exit(1)
                source_bucket_name = file_uri.split("/")[2]
                blob_name = "/".join(file_uri.split("/")[3:])
                source_bucket = stor.bucket(source_bucket_name)
                blob = source_bucket.blob(blob_name)
                blob.download_to_filename(input_csv_path)
        
            checkpoint_utils.save_checkpoint(True, ste_name_prep, args.output_dir)
            sync_state_to_bucket(bucket, args.survey_slug, args.output_dir, admin_ref)
        
    
        # 1. Step 1: Categorization
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
                "--model_name", args.model_name
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

        # 2. Step 2: Report Text Generation
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
                 logging.error(f"Cannot find categorized file: {cat_file}")
                 update_telemetry(db, args.survey_slug, f"Failed: Cannot find categorized file: {cat_file}", is_complete=True)
                 sys.exit(1)
             
            cmd = [
                "generate_report_text",
                "--input_csv", cat_file,
                "--output_dir", args.output_dir,
                "--model_name", args.model_name
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

        # 3. Step 3: Node-based HTML Generation
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
            
            shutil.copytree(report_ui_src, sandbox_dir, ignore=shutil.ignore_patterns("node_modules"))
            os.symlink(os.path.join(report_ui_src, "node_modules"), os.path.join(sandbox_dir, "node_modules"))
            sandbox_input_dir = os.path.join(sandbox_dir, "input")
            os.makedirs(sandbox_input_dir, exist_ok=True)
        
            opinions_src = os.path.join(args.output_dir, "categorized_with_other_filtered.csv")
            summary_src = os.path.join(args.output_dir, "report_data_with_opinions.json")
        
            shutil.copy(opinions_src, os.path.join(sandbox_input_dir, "opinions.csv"))
            shutil.copy(summary_src, os.path.join(sandbox_input_dir, "summary.json"))
        
            # Hydrate explicit config payload
            config_payload = {
                "title": survey_data.get("title", survey_data.get("name", "Survey Results")),
                "overview_chart": admin_data.get("overview_chart", "toggle"),
                "excludedTopics": admin_data.get("excludedTopics", []),
                "excludedOpinions": admin_data.get("excludedOpinions", []),
                "number_of_top_opinions": admin_data.get("number_of_top_opinions", 10),
                "number_of_sample_quotes": admin_data.get("number_of_sample_quotes", 4)
            }
            if "logo" in admin_data and admin_data["logo"]:
                config_payload["logo"] = admin_data["logo"]
            
            config_path = os.path.join(sandbox_input_dir, "config.json")
            with open(config_path, "w") as f:
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
                logging.error(f"Expected generated HTML at {produced_html} but not found.")
                update_telemetry(db, args.survey_slug, "Failed: HTML verification failed", is_complete=True)
                sys.exit(1)

        # 4. Final Push
        if heartbeat:
            heartbeat.set_step("Publishing report to Cloud Storage...", in_categorization=False)
        else:
            update_telemetry(db, args.survey_slug, "Publishing report to Cloud Storage...")
    
        try:
            bucket = stor.bucket(default_bucket_name)
            blob_path = f"reports/{args.survey_slug}/report.html"
            blob = bucket.blob(blob_path)
            blob.upload_from_filename(final_html, content_type="text/html")
            gs_url = f"gs://{default_bucket_name}/{blob_path}"
        
            admin_ref.set({"report_url": gs_url}, merge=True)
            logging.info(f"Deployed report to {gs_url}")
        except Exception as e:
            logging.error(f"Failed to upload report to Cloud Storage: {e}")
            update_telemetry(db, args.survey_slug, "Failed to publish report", is_complete=True)
            sys.exit(1)
        
        if heartbeat:
            heartbeat.stop()
        update_telemetry(db, args.survey_slug, "Complete", is_complete=True)
        logging.info("Survey Analytics Pipeline Finished!")

    except Exception as e:
        logging.error(f"Fatal error in pipeline: {e}", exc_info=True)
        update_telemetry(db, args.survey_slug, f"Failed: {e}", is_complete=True)
        sys.exit(1)
    finally:
        if "heartbeat" in locals() and heartbeat:
            heartbeat.stop()
        if os.path.exists(args.output_dir):
            shutil.rmtree(args.output_dir, ignore_errors=True)
            logging.info(f"Cleaned up temporary output directory: {args.output_dir}")

if __name__ == "__main__":
    main()
