variable "tenancy_ocid" {
  description = "OCID of the tenancy (root compartment)"
  type        = string
}

variable "user_ocid" {
  description = "OCID of the user Terraform authenticates as"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API signing key uploaded to the user profile"
  type        = string
}

variable "private_key_path" {
  description = "Path to the API signing private key"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "OCI region identifier"
  type        = string
  default     = "ap-mumbai-1"
}

variable "ssh_public_key_path" {
  description = "SSH public key installed on the VM for the ubuntu user"
  type        = string
  default     = "~/.ssh/split-vm.pub"
}
