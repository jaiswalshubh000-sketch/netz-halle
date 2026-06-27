import { CanonicalData } from '../canonical/types';

// Map Canonical JSON structure to VDE format (fake target format)
export function mapCanonicalToVDE(canonical: CanonicalData) {
  return {
    "1102": canonical.applicant.firstName,
    "1101": canonical.applicant.lastName,
    "1110": canonical.applicant.email,
    "1109": canonical.applicant.phone,
    "1002": canonical.location.street,
    "1007": canonical.location.zipCode,
    "1008": canonical.location.city,
    "3101": canonical.technical.powerKw,
    "2021": canonical.technical.isPvSystem ? "Ja" : "Nein",
    "1111": canonical.financial.iban,
  };
}
