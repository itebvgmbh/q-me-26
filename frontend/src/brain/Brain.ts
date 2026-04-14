import {
  AcceptEarlierSlotData,
  AcceptEarlierSlotError,
  AcceptEarlierSlotParams,
  AnalyzeCodeHealthData,
  AnalyzeFirestoreUsageData,
  AppointmentIdsRequest,
  AvailableTimeslotsRequest,
  CancelAppointmentEndpointData,
  CancelAppointmentEndpointError,
  CancelAppointmentRequest,
  CheckEarlierSlotsV2Data,
  CheckHealthData,
  CleanupPastSuggestionsData,
  CreateAppointmentEndpointData,
  CreateAppointmentEndpointError,
  CreateAppointmentRequest,
  EmailNotificationRequest,
  FindNewSlotsData,
  FindNewSlotsError,
  GetAvailableTimeslotsData,
  GetAvailableTimeslotsError,
  GetHealthCheckHistoryData,
  GetNotificationHistoryFull2222222Data,
  GetNotificationHistoryFull2222222Error,
  GetNotificationHistoryFull2222222Params,
  GetPublicAvailableTimeslotsData,
  GetPublicAvailableTimeslotsError,
  GetSchedulerStatusData,
  GetUnknownUserNotificationsData,
  GetUserNotificationsData,
  GetUserNotificationsError,
  GetUserNotificationsParams,
  RunNowData,
  SendEmailData,
  SendEmailError,
  SendStaffInvitationData,
  SendStaffInvitationError,
  SetIntervalData,
  SetIntervalError,
  SetIntervalParams,
  StaffInvitationEmailRequest,
  StartSchedulerData,
  StopSchedulerData,
  UpdateAppointmentEndpointData,
  UpdateAppointmentEndpointError,
  UpdateAppointmentRequest,
  UpdateNotificationUserIdData,
  UpdateNotificationUserIdError,
  UpdateUserIdRequest,
} from "./data-contracts";
import { ContentType, HttpClient, RequestParams } from "./http-client";

export class Brain<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * @description Check health of application. Returns 200 when OK, 500 when not.
   *
   * @name check_health
   * @summary Check Health
   * @request GET:/_healthz
   */
  check_health = (params: RequestParams = {}) =>
    this.request<CheckHealthData, any>({
      path: `/_healthz`,
      method: "GET",
      ...params,
    });

  /**
   * @description Send an email using the Databutton notify email service
   *
   * @tags dbtn/module:notifications, dbtn/hasAuth
   * @name send_email
   * @summary Send Email
   * @request POST:/routes/send-email
   */
  send_email = (data: EmailNotificationRequest, params: RequestParams = {}) =>
    this.request<SendEmailData, SendEmailError>({
      path: `/routes/send-email`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Send a staff invitation email with a registration link
   *
   * @tags dbtn/module:notifications, dbtn/hasAuth
   * @name send_staff_invitation
   * @summary Send Staff Invitation
   * @request POST:/routes/send-staff-invitation
   */
  send_staff_invitation = (data: StaffInvitationEmailRequest, params: RequestParams = {}) =>
    this.request<SendStaffInvitationData, SendStaffInvitationError>({
      path: `/routes/send-staff-invitation`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Get history of all earlier slot notifications, acceptances, and reschedulings.
   *
   * @tags dbtn/module:history, dbtn/hasAuth
   * @name get_notification_history_full2222222
   * @summary Get Notification History Full2222222
   * @request GET:/routes/notification-history
   */
  get_notification_history_full2222222 = (query: GetNotificationHistoryFull2222222Params, params: RequestParams = {}) =>
    this.request<GetNotificationHistoryFull2222222Data, GetNotificationHistoryFull2222222Error>({
      path: `/routes/notification-history`,
      method: "GET",
      query: query,
      ...params,
    });

  /**
   * @description Updates the userId in existing notifications for a specific appointment. Used to fix notifications with unknown_user IDs.
   *
   * @tags dbtn/module:fix_notifications, dbtn/hasAuth
   * @name update_notification_user_id
   * @summary Update Notification User Id
   * @request POST:/routes/update-notification-user
   */
  update_notification_user_id = (data: UpdateUserIdRequest, params: RequestParams = {}) =>
    this.request<UpdateNotificationUserIdData, UpdateNotificationUserIdError>({
      path: `/routes/update-notification-user`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Returns a list of notifications that have 'unknown_user' as userId. Used for debugging and fixing issues with user IDs.
   *
   * @tags dbtn/module:fix_notifications, dbtn/hasAuth
   * @name get_unknown_user_notifications
   * @summary Get Unknown User Notifications
   * @request GET:/routes/unknown-notifications
   */
  get_unknown_user_notifications = (params: RequestParams = {}) =>
    this.request<GetUnknownUserNotificationsData, any>({
      path: `/routes/unknown-notifications`,
      method: "GET",
      ...params,
    });

  /**
   * @description Public version of the available-timeslots endpoint that does not require authentication.
   *
   * @tags open, dbtn/module:public_timeslots, dbtn/hasAuth
   * @name get_public_available_timeslots
   * @summary Get Public Available Timeslots
   * @request POST:/routes/public/available-timeslots
   */
  get_public_available_timeslots = (data: AvailableTimeslotsRequest, params: RequestParams = {}) =>
    this.request<GetPublicAvailableTimeslotsData, GetPublicAvailableTimeslotsError>({
      path: `/routes/public/available-timeslots`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Cleanup past timeslot suggestions that are no longer relevant
   *
   * @tags dbtn/module:cleanup, dbtn/hasAuth
   * @name cleanup_past_suggestions
   * @summary Cleanup Past Suggestions
   * @request POST:/routes/cleanup-past-suggestions
   */
  cleanup_past_suggestions = (params: RequestParams = {}) =>
    this.request<CleanupPastSuggestionsData, any>({
      path: `/routes/cleanup-past-suggestions`,
      method: "POST",
      ...params,
    });

  /**
   * @description Create a new appointment with automatic cache invalidation
   *
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name create_appointment_endpoint
   * @summary Create Appointment Endpoint
   * @request POST:/routes/create-appointment
   */
  create_appointment_endpoint = (data: CreateAppointmentRequest, params: RequestParams = {}) =>
    this.request<CreateAppointmentEndpointData, CreateAppointmentEndpointError>({
      path: `/routes/create-appointment`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Update an appointment with automatic cache invalidation
   *
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name update_appointment_endpoint
   * @summary Update Appointment Endpoint
   * @request POST:/routes/update-appointment
   */
  update_appointment_endpoint = (data: UpdateAppointmentRequest, params: RequestParams = {}) =>
    this.request<UpdateAppointmentEndpointData, UpdateAppointmentEndpointError>({
      path: `/routes/update-appointment`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Cancel an appointment with automatic cache invalidation
   *
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name cancel_appointment_endpoint
   * @summary Cancel Appointment Endpoint
   * @request POST:/routes/cancel-appointment
   */
  cancel_appointment_endpoint = (data: CancelAppointmentRequest, params: RequestParams = {}) =>
    this.request<CancelAppointmentEndpointData, CancelAppointmentEndpointError>({
      path: `/routes/cancel-appointment`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Calculate available timeslots for a specific date, considering: - Shop business hours - Staff working hours - Existing appointments - Break times - Service duration If force_refresh is True, the cache will be invalidated first.
   *
   * @tags open, dbtn/module:available_timeslots, dbtn/hasAuth
   * @name get_available_timeslots
   * @summary Get Available Timeslots
   * @request POST:/routes/available-timeslots
   */
  get_available_timeslots = (data: AvailableTimeslotsRequest, params: RequestParams = {}) =>
    this.request<GetAvailableTimeslotsData, GetAvailableTimeslotsError>({
      path: `/routes/available-timeslots`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Start the scheduler to periodically check for earlier slots
   *
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name start_scheduler
   * @summary Start Scheduler
   * @request POST:/routes/start-scheduler
   */
  start_scheduler = (params: RequestParams = {}) =>
    this.request<StartSchedulerData, any>({
      path: `/routes/start-scheduler`,
      method: "POST",
      ...params,
    });

  /**
   * @description Stop the scheduler
   *
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name stop_scheduler
   * @summary Stop Scheduler
   * @request POST:/routes/stop-scheduler
   */
  stop_scheduler = (params: RequestParams = {}) =>
    this.request<StopSchedulerData, any>({
      path: `/routes/stop-scheduler`,
      method: "POST",
      ...params,
    });

  /**
   * @description Get the current status of the scheduler
   *
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name get_scheduler_status
   * @summary Get Scheduler Status
   * @request GET:/routes/scheduler-status
   */
  get_scheduler_status = (params: RequestParams = {}) =>
    this.request<GetSchedulerStatusData, any>({
      path: `/routes/scheduler-status`,
      method: "GET",
      ...params,
    });

  /**
   * @description Set the interval for running the scheduler task
   *
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name set_interval
   * @summary Set Interval
   * @request POST:/routes/set-interval
   */
  set_interval = (query: SetIntervalParams, params: RequestParams = {}) =>
    this.request<SetIntervalData, SetIntervalError>({
      path: `/routes/set-interval`,
      method: "POST",
      query: query,
      ...params,
    });

  /**
   * @description Run the earlier slots check immediately
   *
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name run_now
   * @summary Run Now
   * @request POST:/routes/run-now
   */
  run_now = (params: RequestParams = {}) =>
    this.request<RunNowData, any>({
      path: `/routes/run-now`,
      method: "POST",
      ...params,
    });

  /**
   * @description Accept an earlier slot notification and update the appointment.
   *
   * @tags dbtn/module:accept_slot, dbtn/hasAuth
   * @name accept_earlier_slot
   * @summary Accept Earlier Slot
   * @request POST:/routes/accept-earlier-slot/{notification_id}
   */
  accept_earlier_slot = ({ notificationId, ...query }: AcceptEarlierSlotParams, params: RequestParams = {}) =>
    this.request<AcceptEarlierSlotData, AcceptEarlierSlotError>({
      path: `/routes/accept-earlier-slot/${notificationId}`,
      method: "POST",
      ...params,
    });

  /**
   * @description Find new available earlier slots for appointments
   *
   * @tags dbtn/module:find_slots, dbtn/hasAuth
   * @name find_new_slots
   * @summary Find New Slots
   * @request POST:/routes/find-new-slots
   */
  find_new_slots = (data: AppointmentIdsRequest, params: RequestParams = {}) =>
    this.request<FindNewSlotsData, FindNewSlotsError>({
      path: `/routes/find-new-slots`,
      method: "POST",
      body: data,
      type: ContentType.Json,
      ...params,
    });

  /**
   * @description Check for earlier available slots for appointments where the customer has opted in. This would typically be called by a scheduled job.
   *
   * @tags dbtn/module:check_slots, dbtn/hasAuth
   * @name check_earlier_slots_v2
   * @summary Check Earlier Slots V2
   * @request POST:/routes/check-earlier-slots-v2
   */
  check_earlier_slots_v2 = (params: RequestParams = {}) =>
    this.request<CheckEarlierSlotsV2Data, any>({
      path: `/routes/check-earlier-slots-v2`,
      method: "POST",
      ...params,
    });

  /**
   * @description Get all earlier slot notifications for a specific user. The _t parameter is a cache busting mechanism and is ignored.
   *
   * @tags dbtn/module:user_notifications, dbtn/hasAuth
   * @name get_user_notifications
   * @summary Get User Notifications
   * @request GET:/routes/user-notifications
   */
  get_user_notifications = (query: GetUserNotificationsParams, params: RequestParams = {}) =>
    this.request<GetUserNotificationsData, GetUserNotificationsError>({
      path: `/routes/user-notifications`,
      method: "GET",
      query: query,
      ...params,
    });

  /**
   * No description
   *
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name analyze_code_health
   * @summary Analyze Code Health
   * @request GET:/routes/analyze
   */
  analyze_code_health = (params: RequestParams = {}) =>
    this.request<AnalyzeCodeHealthData, any>({
      path: `/routes/analyze`,
      method: "GET",
      ...params,
    });

  /**
   * No description
   *
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name get_health_check_history
   * @summary Get Health Check History
   * @request GET:/routes/health-history
   */
  get_health_check_history = (params: RequestParams = {}) =>
    this.request<GetHealthCheckHistoryData, any>({
      path: `/routes/health-history`,
      method: "GET",
      ...params,
    });

  /**
   * No description
   *
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name analyze_firestore_usage
   * @summary Analyze Firestore Usage
   * @request GET:/routes/firestore-analysis
   */
  analyze_firestore_usage = (params: RequestParams = {}) =>
    this.request<AnalyzeFirestoreUsageData, any>({
      path: `/routes/firestore-analysis`,
      method: "GET",
      ...params,
    });
}
