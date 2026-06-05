export type Role = 'RIDER' | 'DRIVER';

export interface RiderProfile {
  id: number;
  user_id: number;
  rating: number;
  total_trips: number;
}

export interface DriverProfile {
  id: number;
  user_id: number;
  license_number: string;
  vehicle_model: string;
  plate_number: string;
  verification_status: string;
  rating: number;
  total_trips: number;
}

export interface User {
  id: number;
  full_name: string;
  phone: string | null;
  email: string;
  role: Role;
  status: string;
  auth_provider: string;
  is_verified: boolean;
  profile_image_url?: string | null;
  rider_profile?: RiderProfile | null;
  driver_profile?: DriverProfile | null;
}

export interface RegisterResponse {
  message: string;
  user_id: number;
}

export interface VerifyEmailPayload {
  user_id: number;
  code: string;
}

export interface SocialDriverProfile {
  license_number: string;
  vehicle_model: string;
  plate_number: string;
}

export interface GoogleAuthPayload {
  id_token: string;
  role: Role;
  phone?: string;
  driver_profile?: SocialDriverProfile;
}

export interface AppleAuthPayload {
  identity_token: string;
  full_name?: string;
  role: Role;
  phone?: string;
  driver_profile?: SocialDriverProfile;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface LoginCredentials {
  email_or_phone: string;
  password: string;
}

export interface RegisterRiderPayload {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  role: 'RIDER';
}

export interface RegisterDriverPayload {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  role: 'DRIVER';
  driver_profile: {
    license_number: string;
    vehicle_model: string;
    plate_number: string;
  };
}

export type RegisterPayload = RegisterRiderPayload | RegisterDriverPayload;

export interface UpdateAccountPayload {
  full_name?: string;
  phone?: string;
  email?: string;
  profile_image_url?: string;
}

export interface UpdateDriverProfilePayload {
  license_number?: string;
  vehicle_model?: string;
  plate_number?: string;
}

export interface ApiError {
  message: string;
  detail?: string | { msg: string; type: string }[];
}

// ── Trip types ────────────────────────────────────────────────────────

export interface AssignedDriver {
  id: number;
  full_name: string;
  vehicle_model: string;
  plate_number: string;
  rating: number;
  photo_url?: string;
  driver_phone?: string;
}

export interface TripStatusHistory {
  id: number;
  status: string;
  changed_by: 'RIDER' | 'DRIVER' | 'SYSTEM';
  note: string | null;
  created_at: string;
}

export type TripStatus =
  | 'SEARCHING_DRIVER'
  | 'NO_DRIVER_AVAILABLE'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Trip {
  id: number;
  trip_name: string | null;
  rider_id: number;
  driver_id: number | null;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  ride_type: 'BODA';
  payment_method: 'CASH';
  fare_tzs: number | null;
  status: TripStatus;
  message: string;
  rider_phone?: string;
  created_at: string;
  updated_at: string;
  assigned_driver: AssignedDriver | null;
  status_history: TripStatusHistory[] | null;
}

// ── Driver types ──────────────────────────────────────────────────────

export interface DriverOut {
  id: number;
  user_id: number;
  driver_profile_id: number;
  full_name: string;
  vehicle_model: string;
  plate_number: string;
  verification_status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rating: number;
  total_trips: number;
  status: 'OFFLINE' | 'AVAILABLE' | 'BUSY';
  created_at: string;
  updated_at: string;
}

// ── Offer types ───────────────────────────────────────────────────────

export interface OfferTrip {
  id: number;
  pickup_address: string;
  destination_address: string;
  ride_type: 'BODA';
  payment_method: 'CASH';
  status: string;
}

export interface Offer {
  id: number;
  trip_id: number;
  driver_id: number;
  status: 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
  updated_at: string;
  trip: OfferTrip | null;
}

// ── Driver offer response types ───────────────────────────────────────

export interface AcceptOfferResponse {
  message: string;
  offer: Offer;
  trip: Record<string, unknown>;
  driver: DriverOut;
  next_action: string;
}

export interface DeclineOfferResponse {
  message: string;
  offer: Offer;
  next_action: string;
}

// ── Notification types ────────────────────────────────────────────────

// ── Password reset types ──────────────────────────────────────────────

export type ResetMethod = 'email' | 'sms';

export interface ForgotPasswordPayload {
  email_or_phone: string;
  method: ResetMethod;
}

export interface VerifyResetCodePayload {
  email_or_phone: string;
  code: string;
}

export interface VerifyResetCodeResponse {
  reset_token: string;
  message: string;
}

export interface ResetPasswordPayload {
  reset_token: string;
  new_password: string;
}

// ── Notification types ────────────────────────────────────────────────

export interface UserNotification {
  id: number;
  recipient_role: 'RIDER' | 'DRIVER';
  recipient_profile_id: number;
  title: string;
  message: string;
  type: string;
  related_trip_id: number | null;
  related_offer_id: number | null;
  is_read: boolean;
  created_at: string;
}
