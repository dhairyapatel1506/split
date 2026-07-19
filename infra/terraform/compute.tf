data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Always resolve the newest Ubuntu 24.04 ARM image instead of pinning an
# OCID — image OCIDs differ per region and old ones get retired.
data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "split" {
  compartment_id      = var.tenancy_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "split"
  shape               = "VM.Standard.A1.Flex"

  # The full Always Free Ampere allotment in a single VM.
  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.split.id
    assign_public_ip = true
    hostname_label   = "split"
  }

  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }

  # Replacing the VM must never take the app's data with it; volumes and
  # backups own the data, the instance stays disposable.
  preserve_boot_volume = false
}
