output "public_ip" {
  description = "Public IP of the VM — point split.dhairya.cloud's A record here"
  value       = oci_core_instance.split.public_ip
}
