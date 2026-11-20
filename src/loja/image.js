export const DEFAULT_GALLERY_IMAGE = "/subscriptions/02daccdd-f01a-4b29-adad-3322cba43a21/resourceGroups/REIDO7/providers/Microsoft.Compute/galleries/atlas/images/Atlas2.0/versions/1.0.0";

const GALLERY = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/galleries\/[^/]+\/images\/[^/]+(?:\/versions\/[^/]+)?$/i;

export function isGalleryImage(value) {
  return GALLERY.test(String(value ?? "").trim());
}

export function parseGalleryImage(value) {
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/galleries\/([^/]+)\/images\/([^/]+)(?:\/versions\/([^/]+))?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  return { subscription: match[1], group: match[2], gallery: match[3], image: match[4], version: match[5] || "" };
}

export function withGalleryVersion(id, version) {
  return `${String(id).replace(/\/versions\/[^/]+$/i, "")}/versions/${version}`;
}

export function preferVersion(versions) {
  const list = [...(versions || [])].filter(Boolean);
  if (list.includes("2.0.0")) return "2.0.0";
  return list.sort((left, right) => {
    const a = String(left).split(".").map(Number);
    const b = String(right).split(".").map(Number);
    const size = Math.max(a.length, b.length);
    for (let index = 0; index < size; index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff) return diff;
    }
    return 0;
  }).at(-1) || "";
}

export function resolveGalleryImage({ storedId = "", storedKind = "", envId = "" } = {}) {
  if (storedKind === "snapshot" && storedId) return { kind: "snapshot", id: storedId };
  const chosen = [storedId, envId, DEFAULT_GALLERY_IMAGE].map((item) => String(item ?? "").trim()).find((item) => isGalleryImage(item));
  return { kind: "gallery", id: chosen || DEFAULT_GALLERY_IMAGE };
}

export function buildDataDisk({ location, zone = "", gb, iops, throughput }) {
  const disk = {
    location,
    sku: { name: "PremiumV2_LRS" },
    creationData: { createOption: "Empty" },
    diskSizeGB: gb,
    diskIOPSReadWrite: iops,
    diskMBpsReadWrite: throughput,
  };
  if (zone) disk.zones = [String(zone)];
  return disk;
}

export function buildSpecializedVm({ location, size, nicId, imageId, diskGb = 512, diskType = "PremiumV2_LRS", spot = false, diskName = "", zone = "", dataDisks = [] }) {
  const parameters = {
    location,
    hardwareProfile: { vmSize: size },
    securityProfile: {
      securityType: "TrustedLaunch",
      uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
    },
    storageProfile: {
      imageReference: { id: imageId },
      diskControllerType: "SCSI",
      osDisk: {
        osType: "Windows",
        createOption: "FromImage",
        diskSizeGB: diskGb,
        managedDisk: { storageAccountType: diskType },
      },
    },
    networkProfile: { networkInterfaces: [{ id: nicId, primary: true }] },
  };
  if (diskName) parameters.storageProfile.osDisk.name = diskName;
  if (zone) parameters.zones = [String(zone)];
  if (dataDisks.length) parameters.storageProfile.dataDisks = dataDisks;
  if (spot) {
    parameters.priority = "Spot";
    parameters.evictionPolicy = "Deallocate";
    parameters.billingProfile = { maxPrice: -1 };
  }
  return parameters;
}
