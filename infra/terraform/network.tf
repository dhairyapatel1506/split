# One VCN (Oracle's VPC) with a single public subnet. The VM gets a
# public IP; the security list is the cloud-side firewall in front of it.

resource "oci_core_vcn" "split" {
  compartment_id = var.tenancy_ocid
  display_name   = "split-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "split"
}

# Without an internet gateway + route to it, a "public" subnet is public
# in name only — no packets can actually reach or leave it.
resource "oci_core_internet_gateway" "split" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.split.id
  display_name   = "split-igw"
}

resource "oci_core_route_table" "split" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.split.id
  display_name   = "split-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.split.id
  }
}

resource "oci_core_security_list" "split" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.split.id
  display_name   = "split-sl"

  # Only SSH, HTTP and HTTPS are reachable from the internet. Postgres
  # and Redis have no host ports at all, so this is defence in depth.
  dynamic "ingress_security_rules" {
    for_each = [22, 80, 443]
    content {
      protocol = "6" # TCP
      source   = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "split" {
  compartment_id    = var.tenancy_ocid
  vcn_id            = oci_core_vcn.split.id
  display_name      = "split-public"
  cidr_block        = "10.0.1.0/24"
  dns_label         = "pub"
  route_table_id    = oci_core_route_table.split.id
  security_list_ids = [oci_core_security_list.split.id]
}
