/** AppointmentIdsRequest */
export interface AppointmentIdsRequest {
  /** Appointment Ids */
  appointment_ids: string[];
}

/** AvailableTimeslotsRequest */
export interface AvailableTimeslotsRequest {
  /** Shop Id */
  shop_id: string;
  /** Staff Id */
  staff_id?: string | null;
  /** Service Id */
  service_id: string;
  /**
   * Date
   * @format date-time
   */
  date: string;
  /**
   * Force Refresh
   * @default false
   */
  force_refresh?: boolean | null;
}

/** AvailableTimeslotsResponse */
export interface AvailableTimeslotsResponse {
  /** Timeslots */
  timeslots: TimeSlot[];
}

/** CancelAppointmentRequest */
export interface CancelAppointmentRequest {
  /** Appointmentid */
  appointmentId: string;
}

/** CheckEarlierSlotsResponse */
export interface CheckEarlierSlotsResponse {
  /** Notifications Created */
  notifications_created: number;
  /** Appointments Checked */
  appointments_checked: number;
  /** Appointments With Earlier Slots */
  appointments_with_earlier_slots: number;
}

/** CreateAppointmentRequest */
export interface CreateAppointmentRequest {
  /** Shopid */
  shopId: string;
  /** Staffid */
  staffId?: string | null;
  /** Serviceid */
  serviceId: string;
  /** Servicename */
  serviceName: string;
  /** Customerid */
  customerId?: string | null;
  /** Customername */
  customerName: string;
  /** Starttime */
  startTime: string;
  /** Endtime */
  endTime: string;
  /** Notes */
  notes?: string | null;
  /** Price */
  price?: number | null;
  /**
   * Isanonymous
   * @default false
   */
  isAnonymous?: boolean | null;
  /** Anonymousreferencecode */
  anonymousReferenceCode?: string | null;
}

/** EmailNotificationRequest */
export interface EmailNotificationRequest {
  /**
   * To
   * @format email
   */
  to: string;
  /** Subject */
  subject: string;
  /** Content Html */
  content_html: string;
  /** Content Text */
  content_text: string;
  /** Template Data */
  template_data?: Record<string, any> | null;
}

/** HTTPValidationError */
export interface HTTPValidationError {
  /** Detail */
  detail?: ValidationError[];
}

/** HealthResponse */
export interface HealthResponse {
  /** Status */
  status: string;
}

/** NotificationHistoryItem */
export interface NotificationHistoryItem {
  /** Id */
  id: string;
  /** Appointmentid */
  appointmentId: string;
  /** Userid */
  userId: string;
  /** Username */
  userName?: string | null;
  /** Shopid */
  shopId: string;
  /** Shopname */
  shopName?: string | null;
  /** Staffid */
  staffId: string;
  /** Staffname */
  staffName?: string | null;
  /** Originalstarttime */
  originalStartTime?: string | null;
  /** Earlierstarttime */
  earlierStartTime?: string | null;
  /** Createdat */
  createdAt?: string | null;
  /**
   * Isaccepted
   * @default false
   */
  isAccepted?: boolean;
  /** Acceptedat */
  acceptedAt?: string | null;
  /** Timedifference */
  timeDifference?: number | null;
  /** Appointmentduration */
  appointmentDuration?: number | null;
}

/** NotificationItem */
export interface NotificationItem {
  /** Id */
  id: string;
  /** Appointmentid */
  appointmentId: string;
  /** Userid */
  userId: string;
  /** Shopid */
  shopId: string;
  /** Staffid */
  staffId: string;
  /** Serviceid */
  serviceId: string;
  /**
   * Originalstarttime
   * @format date-time
   */
  originalStartTime: string;
  /**
   * Originalendtime
   * @format date-time
   */
  originalEndTime: string;
  /**
   * Earlierstarttime
   * @format date-time
   */
  earlierStartTime: string;
  /**
   * Earlierendtime
   * @format date-time
   */
  earlierEndTime: string;
  /**
   * Createdat
   * @format date-time
   */
  createdAt: string;
  /** Isread */
  isRead: boolean;
  /** Isaccepted */
  isAccepted: boolean;
}

/** StaffInvitationEmailRequest */
export interface StaffInvitationEmailRequest {
  /** Invitation Id */
  invitation_id: string;
  /** Shop Id */
  shop_id: string;
  /**
   * Email
   * @format email
   */
  email: string;
  /** Invitation Link */
  invitation_link: string;
}

/** TimeSlot */
export interface TimeSlot {
  /**
   * Start Time
   * @format date-time
   */
  start_time: string;
  /**
   * End Time
   * @format date-time
   */
  end_time: string;
  /** Is Available */
  is_available: boolean;
}

/** UpdateAppointmentRequest */
export interface UpdateAppointmentRequest {
  /** Appointmentid */
  appointmentId: string;
  /** Status */
  status?: string | null;
  /** Staffid */
  staffId?: string | null;
  /** Serviceid */
  serviceId?: string | null;
  /** Servicename */
  serviceName?: string | null;
  /** Customerid */
  customerId?: string | null;
  /** Customername */
  customerName?: string | null;
  /** Starttime */
  startTime?: string | null;
  /** Endtime */
  endTime?: string | null;
  /** Notes */
  notes?: string | null;
  /** Price */
  price?: number | null;
}

/** UpdateResult */
export interface UpdateResult {
  /** Updated Notifications */
  updated_notifications: number;
  /** Message */
  message: string;
}

/** UpdateUserIdRequest */
export interface UpdateUserIdRequest {
  /** Appointment Id */
  appointment_id: string;
  /** New User Id */
  new_user_id: string;
}

/** ValidationError */
export interface ValidationError {
  /** Location */
  loc: (string | number)[];
  /** Message */
  msg: string;
  /** Error Type */
  type: string;
}

export type CheckHealthData = HealthResponse;

/** Response Send Email */
export type SendEmailData = Record<string, string>;

export type SendEmailError = HTTPValidationError;

/** Response Send Staff Invitation */
export type SendStaffInvitationData = Record<string, string>;

export type SendStaffInvitationError = HTTPValidationError;

export interface GetNotificationHistoryFull2222222Params {
  /**
   * Limit
   * @default 100
   */
  limit?: number;
}

/** Response Get Notification History Full2222222 */
export type GetNotificationHistoryFull2222222Data = NotificationHistoryItem[];

export type GetNotificationHistoryFull2222222Error = HTTPValidationError;

export type UpdateNotificationUserIdData = UpdateResult;

export type UpdateNotificationUserIdError = HTTPValidationError;

/** Response Get Unknown User Notifications */
export type GetUnknownUserNotificationsData = Record<string, any>[];

export type GetPublicAvailableTimeslotsData = AvailableTimeslotsResponse;

export type GetPublicAvailableTimeslotsError = HTTPValidationError;

/** Response Cleanup Past Suggestions */
export type CleanupPastSuggestionsData = number;

/** Response Create Appointment Endpoint */
export type CreateAppointmentEndpointData = Record<string, any>;

export type CreateAppointmentEndpointError = HTTPValidationError;

/** Response Update Appointment Endpoint */
export type UpdateAppointmentEndpointData = Record<string, string>;

export type UpdateAppointmentEndpointError = HTTPValidationError;

/** Response Cancel Appointment Endpoint */
export type CancelAppointmentEndpointData = Record<string, string>;

export type CancelAppointmentEndpointError = HTTPValidationError;

export type GetAvailableTimeslotsData = AvailableTimeslotsResponse;

export type GetAvailableTimeslotsError = HTTPValidationError;

/** Response Start Scheduler */
export type StartSchedulerData = Record<string, string>;

/** Response Stop Scheduler */
export type StopSchedulerData = Record<string, string>;

/** Response Get Scheduler Status */
export type GetSchedulerStatusData = Record<string, any>;

export interface SetIntervalParams {
  /** Interval Seconds */
  interval_seconds: number;
}

/** Response Set Interval */
export type SetIntervalData = Record<string, any>;

export type SetIntervalError = HTTPValidationError;

/** Response Run Now */
export type RunNowData = Record<string, any>;

export interface AcceptEarlierSlotParams {
  /** Notification Id */
  notificationId: string;
}

/** Response Accept Earlier Slot */
export type AcceptEarlierSlotData = Record<string, string>;

export type AcceptEarlierSlotError = HTTPValidationError;

/** Response Find New Slots */
export type FindNewSlotsData = Record<string, any>;

export type FindNewSlotsError = HTTPValidationError;

export type CheckEarlierSlotsV2Data = CheckEarlierSlotsResponse;

export interface GetUserNotificationsParams {
  /** Userid */
  userId: string;
  /**  T */
  _t?: string | null;
}

/** Response Get User Notifications */
export type GetUserNotificationsData = NotificationItem[];

export type GetUserNotificationsError = HTTPValidationError;

export type AnalyzeCodeHealthData = any;

export type GetHealthCheckHistoryData = any;

export type AnalyzeFirestoreUsageData = any;
