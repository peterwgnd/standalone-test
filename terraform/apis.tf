# Enable required GCP APIs
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "appengine.googleapis.com",
    "cloudfunctions.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "logging.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "recaptchaenterprise.googleapis.com"
  ])

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

# Create a 60-second delay after enabling APIs to allow GCP service controllers to propagate
resource "time_sleep" "wait_60_seconds" {
  depends_on      = [google_project_service.services]
  create_duration = "60s"
}
