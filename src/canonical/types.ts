export interface CanonicalData {
  source_channel: 'email' | 'fax' | 'letter' | 'phone_call' | 'sms' | null;
  sentiment: string | null;
  applicant: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  location: {
    street: string | null;
    zipCode: string | null;
    city: string | null;
  };
  technical: {
    powerKw: number | null;
    isPvSystem: boolean;
  };
  financial: {
    iban: string | null;
  };
  missing_mandatory_fields: string[];
}
