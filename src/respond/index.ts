import { CanonicalData } from '../canonical/types';

export function generateMissingFieldsResponse(data: CanonicalData): string {
  if (data.missing_mandatory_fields.length === 0) {
    return `Dear ${data.applicant.firstName || ''} ${data.applicant.lastName || 'Customer'},\n\nThank you for your grid connection request. Your documents are complete and will now be processed.\n\nBest regards,\nNetz Halle Team`;
  }

  const missingList = data.missing_mandatory_fields.map(field => {
    switch (field) {
      case 'applicant.firstName': return '- First Name';
      case 'applicant.lastName': return '- Last Name';
      case 'applicant.contact (email or phone)': return '- Contact Info (Email or Phone)';
      case 'location.street': return '- System Location (Street)';
      case 'location.zipCode': return '- System Location (ZIP Code)';
      case 'location.city': return '- System Location (City)';
      case 'technical.powerKw': return '- Installed Power in kW';
      case 'Invalid powerKw: Must be <= 30 kW': return '- Correction of System Power (Must be <= 30 kW)';
      case 'financial.iban': return '- Bank Details (IBAN)';
      default: return `- ${field}`;
    }
  }).join('\n');

  return `Dear ${data.applicant.firstName || ''} ${data.applicant.lastName || 'Customer'},\n\nThank you for your grid connection request. In order to process your request, we still need the following information from you:\n\n${missingList}\n\nPlease provide these details as soon as possible.\n\nBest regards,\nNetz Halle Team`;
}
