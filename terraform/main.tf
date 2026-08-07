# 1. Artifact Registry for Docker Images
resource "google_artifact_registry_repository" "app_repo" {
  repository_id = "standalone-analytics-repo"
  format        = "DOCKER"
  location      = var.region
  description   = "Docker repository for Standalone Sensemaking AI"
  depends_on    = [time_sleep.wait_60_seconds]
}

# Fetch GCP project details (including project number for Cloud Build SA)
data "google_project" "project" {
  project_id = var.project_id
}

# Grant Cloud Build service account permission to push Docker images to Artifact Registry
resource "google_project_iam_member" "cloudbuild_push" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# Grant default Compute Engine service account (used by Cloud Functions Gen 2) required Eventarc & Firestore permissions
resource "google_project_iam_member" "functions_eventarc_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "functions_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# Grant Cloud Functions permission to trigger/cancel Cloud Run Jobs
resource "google_project_iam_member" "functions_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "functions_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# Grant Cloud Functions permission to delete files during survey deep-deletion
resource "google_project_iam_member" "functions_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# 2. Secret Manager Shell for Gemini API Key
resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "GEMINI_API_KEY"

  replication {
    auto {}
  }
  depends_on = [time_sleep.wait_60_seconds]
}

# 3. Dedicated Service Account for Cloud Run Job
resource "google_service_account" "cloud_run_sa" {
  account_id   = "analytics-orchestrator-sa"
  display_name = "Cloud Run Job Service Account"
}

# Grant the Service Account access to Datastore/Firestore
resource "google_project_iam_member" "firestore_access" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Grant the Service Account access to read the Secret
resource "google_secret_manager_secret_iam_member" "secret_access" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Grant the Service Account access to Cloud Storage
resource "google_project_iam_member" "cloud_run_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# 4. Create the Firestore Database
resource "google_firestore_database" "standalone" {
  project     = var.project_id
  name        = "standalone"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [time_sleep.wait_60_seconds]
}

# 5. Create the Firebase Project
resource "google_firebase_project" "default" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [time_sleep.wait_60_seconds]
}

# 6. Create the Default App Engine Application (provisions default Firebase Storage bucket <project-id>.appspot.com)
resource "google_app_engine_application" "default" {
  provider    = google-beta
  project     = var.project_id
  location_id = "us-central"
  depends_on  = [time_sleep.wait_60_seconds]

  lifecycle {
    ignore_changes = [location_id]
  }
}

resource "google_firebase_storage_bucket" "default" {
  provider   = google-beta
  project    = var.project_id
  bucket_id  = google_app_engine_application.default.default_bucket
  depends_on = [google_firebase_project.default]
}

# 7. Create the Firebase Web App
resource "google_firebase_web_app" "svelte_app" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Svelte Admin UI"
  depends_on = [
    google_firebase_project.default,
    google_firebase_storage_bucket.default
  ]
}

# 8. Cloud Run Job (Using Dummy Image & Lifecycle Ignore)
resource "google_cloud_run_v2_job" "analytics_orchestrator" {
  name     = "analytics-orchestrator-job"
  location = var.region
  project  = var.project_id

  template {
    template {
      timeout         = "86400s" # 24 hours
      service_account = google_service_account.cloud_run_sa.email

      containers {
        image = "us-docker.pkg.dev/cloudrun/container/hello"

        resources {
          limits = {
            memory = "4Gi"
            cpu    = "2"
          }
        }

        env {
          name = "GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.gemini_api_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image
    ]
  }

  depends_on = [
    google_artifact_registry_repository.app_repo,
    google_firestore_database.standalone,
    google_project_iam_member.firestore_access,
    google_secret_manager_secret_iam_member.secret_access,
    google_project_iam_member.cloud_run_storage_admin
  ]
}

# 9. Initialize Identity Platform Config (Firebase Authentication)
resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  # This natively handles the duplicate email setting
  sign_in {
    allow_duplicate_emails = false
  }

  depends_on = [
    time_sleep.wait_60_seconds,
    google_firebase_project.default
  ]
}

# 10. reCAPTCHA Enterprise Key for Firebase App Check
resource "google_recaptcha_enterprise_key" "app_check_key" {
  display_name = "standalone-app-check-key"
  project      = var.project_id

  web_settings {
    integration_type  = "SCORE"
    allow_all_domains = true
  }

  depends_on = [time_sleep.wait_60_seconds]
}

# A. Force GCP to provision the hidden Firebase App Check Service Agent
resource "google_project_service_identity" "app_check_sa" {
  provider   = google-beta
  project    = var.project_id
  service    = "firebaseappcheck.googleapis.com"
  depends_on = [time_sleep.wait_60_seconds]
}

# B. Grant the Service Agent permission to verify reCAPTCHA tokens
resource "google_project_iam_member" "app_check_recaptcha_agent" {
  project = var.project_id
  role    = "roles/recaptchaenterprise.agent"
  member  = "serviceAccount:${google_project_service_identity.app_check_sa.email}"
}

# 11. Firebase App Check Config with reCAPTCHA Enterprise
resource "google_firebase_app_check_recaptcha_enterprise_config" "default" {
  provider = google-beta
  project  = var.project_id
  app_id   = google_firebase_web_app.svelte_app.app_id
  site_key = basename(google_recaptcha_enterprise_key.app_check_key.name)

  depends_on = [
    google_firebase_project.default,
    google_recaptcha_enterprise_key.app_check_key,
    google_project_iam_member.app_check_recaptcha_agent
  ]
}

# 12. Enforce App Check on Firestore
resource "google_firebase_app_check_service_config" "firestore" {
  provider   = google-beta
  project    = var.project_id
  service_id = "firestore.googleapis.com"

  # Set to "UNENFORCED" (Audit Mode) to prevent ad-blocker lockouts
  enforcement_mode = "UNENFORCED"

  depends_on = [google_firebase_app_check_recaptcha_enterprise_config.default]
}

