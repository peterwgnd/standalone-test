variable "project_id" {
  type        = string
  description = "The GCP Project ID"
}

variable "region" {
  type        = string
  description = "The GCP region to deploy resources to"
  default     = "us-central1"
}

variable "gemini_api_key" {
  type        = string
  description = "The Gemini API Key"
  sensitive   = true
}
