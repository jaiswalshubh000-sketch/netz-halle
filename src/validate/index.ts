import { CanonicalData } from '../canonical/types';

export function validateCanonicalData(data: CanonicalData) {
  const missing: string[] = [];
  
  if (!data.applicant.firstName) missing.push('applicant.firstName');
  if (!data.applicant.lastName) missing.push('applicant.lastName');
  if (!data.applicant.email && !data.applicant.phone) missing.push('applicant.contact (email or phone)');
  
  if (!data.location.street) missing.push('location.street');
  if (!data.location.zipCode) missing.push('location.zipCode');
  if (!data.location.city) missing.push('location.city');
  
  if (data.technical.powerKw === null) missing.push('technical.powerKw');
  // Hackathon scope: powerKw must be <= 30
  if (data.technical.powerKw !== null && data.technical.powerKw > 30) {
     missing.push('Invalid powerKw: Must be <= 30 kW');
  }

  // financial iban might be mandatory for specific grid connection processes
  if (!data.financial.iban) missing.push('financial.iban');

  return {
    isValid: missing.length === 0,
    missing,
  };
}
