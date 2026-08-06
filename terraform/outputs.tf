output "artifact_registry_url" {
  description = "The URL of the Artifact Registry repository."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app_repo.repository_id}"
}

output "recaptcha_site_key" {
  description = "The reCAPTCHA Enterprise Site Key for Firebase App Check."
  value       = basename(google_recaptcha_enterprise_key.app_check_key.name)
}

output "firebase_app_id" {
  description = "The exact App ID of the newly provisioned Firebase Web App."
  value       = google_firebase_web_app.svelte_app.app_id
}
