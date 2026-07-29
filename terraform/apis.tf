# Enable required GCP APIs
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "firebase.googleapis.com"
  ])

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}
