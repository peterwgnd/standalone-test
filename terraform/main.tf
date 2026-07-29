# 1. Artifact Registry for Docker Images
resource "google_artifact_registry_repository" "app_repo" {
  repository_id = "standalone-analytics-repo"
  format        = "DOCKER"
  location      = var.region
  description   = "Docker repository for the Standalone Analytics Platform"
}

# 2. Secret Manager Shell for Gemini API Key
resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"
  
  replication {
    auto {}
  }
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

# 4. Create the Firebase Web App
resource "google_firebase_web_app" "svelte_app" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Svelte Admin UI"
}

# 5. Fetch the config object for the app we just created
data "google_firebase_web_app_config" "svelte_app_config" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.svelte_app.app_id
}

# 6. Write the config to a JSON file in your Svelte directory
resource "local_file" "firebase_config" {
  content  = jsonencode({
    apiKey            = data.google_firebase_web_app_config.svelte_app_config.api_key
    authDomain        = data.google_firebase_web_app_config.svelte_app_config.auth_domain
    projectId         = data.google_firebase_web_app_config.svelte_app_config.project
    storageBucket     = lookup(data.google_firebase_web_app_config.svelte_app_config, "storage_bucket", "")
    messagingSenderId = lookup(data.google_firebase_web_app_config.svelte_app_config, "messaging_sender_id", "")
    appId             = data.google_firebase_web_app_config.svelte_app_config.app_id
  })
  filename = "${path.module}/../front-end/src/firebase-config.json"
}

# 7. Create the initial Secret Version so Cloud Run doesn't fail
resource "google_secret_manager_secret_version" "gemini_api_key_data" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

# 8. Cloud Run Job (Using Dummy Image & Lifecycle Ignore)
resource "google_cloud_run_v2_job" "analytics_orchestrator" {
  name     = "analytics-orchestrator-job"
  location = var.region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.cloud_run_sa.email
      
      containers {
        image = "us-docker.pkg.dev/cloudrun/container/hello"

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
    google_project_iam_member.firestore_access,
    google_secret_manager_secret_iam_member.secret_access,
    google_secret_manager_secret_version.gemini_api_key_data
  ]
}
