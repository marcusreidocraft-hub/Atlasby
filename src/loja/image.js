export const DEFAULT_GALLERY_IMAGE = "/subscriptions/02daccdd-f01a-4b29-adad-3322cba43a21/resourceGroups/REIDO7/providers/Microsoft.Compute/galleries/atlas/images/Atlas2.0/versions/1.0.0";

const GALLERY = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/galleries\/[^/]+\/images\/[^/]+(?:\/versions\/[^/]+)?$/i;

export function isGalleryImage(value) {
  return GALLERY.test(String(value ?? "").trim());
}

export function resolveGalleryImage({ storedId = "", storedKind = "", envId = "" } = {}) {
  if (storedKind === "snapshot" && storedId) return { kind: "snapshot", id: storedId };
  const chosen = [storedId, envId, DEFAULT_GALLERY_IMAGE].map((item) => String(item ?? "").trim()).find((item) => isGalleryImage(item));
  return { kind: "gallery", id: chosen || DEFAULT_GALLERY_IMAGE };
}

export function buildSpecializedVm({ location, size, nicId, imageId, diskGb = 512, diskType = "PremiumV2_LRS", spot = false, diskName = "" }) {
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
  if (spot) {
    parameters.priority = "Spot";
    parameters.evictionPolicy = "Deallocate";
    parameters.billingProfile = { maxPrice: -1 };
  }
  return parameters;
}
