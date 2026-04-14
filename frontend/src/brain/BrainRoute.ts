import {
  AcceptEarlierSlotData,
  AnalyzeCodeHealthData,
  AnalyzeFirestoreUsageData,
  AppointmentIdsRequest,
  AvailableTimeslotsRequest,
  CancelAppointmentEndpointData,
  CancelAppointmentRequest,
  CheckEarlierSlotsV2Data,
  CheckHealthData,
  CleanupPastSuggestionsData,
  CreateAppointmentEndpointData,
  CreateAppointmentRequest,
  EmailNotificationRequest,
  FindNewSlotsData,
  GetAvailableTimeslotsData,
  GetHealthCheckHistoryData,
  GetNotificationHistoryFull2222222Data,
  GetPublicAvailableTimeslotsData,
  GetSchedulerStatusData,
  GetUnknownUserNotificationsData,
  GetUserNotificationsData,
  RunNowData,
  SendEmailData,
  SendStaffInvitationData,
  SetIntervalData,
  StaffInvitationEmailRequest,
  StartSchedulerData,
  StopSchedulerData,
  UpdateAppointmentEndpointData,
  UpdateAppointmentRequest,
  UpdateNotificationUserIdData,
  UpdateUserIdRequest,
} from "./data-contracts";

export namespace Brain {
  /**
   * @description Check health of application. Returns 200 when OK, 500 when not.
   * @name check_health
   * @summary Check Health
   * @request GET:/_healthz
   */
  export namespace check_health {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = CheckHealthData;
  }

  /**
   * @description Send an email using the Databutton notify email service
   * @tags dbtn/module:notifications, dbtn/hasAuth
   * @name send_email
   * @summary Send Email
   * @request POST:/routes/send-email
   */
  export namespace send_email {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = EmailNotificationRequest;
    export type RequestHeaders = {};
    export type ResponseBody = SendEmailData;
  }

  /**
   * @description Send a staff invitation email with a registration link
   * @tags dbtn/module:notifications, dbtn/hasAuth
   * @name send_staff_invitation
   * @summary Send Staff Invitation
   * @request POST:/routes/send-staff-invitation
   */
  export namespace send_staff_invitation {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = StaffInvitationEmailRequest;
    export type RequestHeaders = {};
    export type ResponseBody = SendStaffInvitationData;
  }

  /**
   * @description Get history of all earlier slot notifications, acceptances, and reschedulings.
   * @tags dbtn/module:history, dbtn/hasAuth
   * @name get_notification_history_full2222222
   * @summary Get Notification History Full2222222
   * @request GET:/routes/notification-history
   */
  export namespace get_notification_history_full2222222 {
    export type RequestParams = {};
    export type RequestQuery = {
      /**
       * Limit
       * @default 100
       */
      limit?: number;
    };
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = GetNotificationHistoryFull2222222Data;
  }

  /**
   * @description Updates the userId in existing notifications for a specific appointment. Used to fix notifications with unknown_user IDs.
   * @tags dbtn/module:fix_notifications, dbtn/hasAuth
   * @name update_notification_user_id
   * @summary Update Notification User Id
   * @request POST:/routes/update-notification-user
   */
  export namespace update_notification_user_id {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = UpdateUserIdRequest;
    export type RequestHeaders = {};
    export type ResponseBody = UpdateNotificationUserIdData;
  }

  /**
   * @description Returns a list of notifications that have 'unknown_user' as userId. Used for debugging and fixing issues with user IDs.
   * @tags dbtn/module:fix_notifications, dbtn/hasAuth
   * @name get_unknown_user_notifications
   * @summary Get Unknown User Notifications
   * @request GET:/routes/unknown-notifications
   */
  export namespace get_unknown_user_notifications {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = GetUnknownUserNotificationsData;
  }

  /**
   * @description Public version of the available-timeslots endpoint that does not require authentication.
   * @tags open, dbtn/module:public_timeslots, dbtn/hasAuth
   * @name get_public_available_timeslots
   * @summary Get Public Available Timeslots
   * @request POST:/routes/public/available-timeslots
   */
  export namespace get_public_available_timeslots {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = AvailableTimeslotsRequest;
    export type RequestHeaders = {};
    export type ResponseBody = GetPublicAvailableTimeslotsData;
  }

  /**
   * @description Cleanup past timeslot suggestions that are no longer relevant
   * @tags dbtn/module:cleanup, dbtn/hasAuth
   * @name cleanup_past_suggestions
   * @summary Cleanup Past Suggestions
   * @request POST:/routes/cleanup-past-suggestions
   */
  export namespace cleanup_past_suggestions {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = CleanupPastSuggestionsData;
  }

  /**
   * @description Create a new appointment with automatic cache invalidation
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name create_appointment_endpoint
   * @summary Create Appointment Endpoint
   * @request POST:/routes/create-appointment
   */
  export namespace create_appointment_endpoint {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = CreateAppointmentRequest;
    export type RequestHeaders = {};
    export type ResponseBody = CreateAppointmentEndpointData;
  }

  /**
   * @description Update an appointment with automatic cache invalidation
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name update_appointment_endpoint
   * @summary Update Appointment Endpoint
   * @request POST:/routes/update-appointment
   */
  export namespace update_appointment_endpoint {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = UpdateAppointmentRequest;
    export type RequestHeaders = {};
    export type ResponseBody = UpdateAppointmentEndpointData;
  }

  /**
   * @description Cancel an appointment with automatic cache invalidation
   * @tags dbtn/module:appointments, dbtn/hasAuth
   * @name cancel_appointment_endpoint
   * @summary Cancel Appointment Endpoint
   * @request POST:/routes/cancel-appointment
   */
  export namespace cancel_appointment_endpoint {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = CancelAppointmentRequest;
    export type RequestHeaders = {};
    export type ResponseBody = CancelAppointmentEndpointData;
  }

  /**
   * @description Calculate available timeslots for a specific date, considering: - Shop business hours - Staff working hours - Existing appointments - Break times - Service duration If force_refresh is True, the cache will be invalidated first.
   * @tags open, dbtn/module:available_timeslots, dbtn/hasAuth
   * @name get_available_timeslots
   * @summary Get Available Timeslots
   * @request POST:/routes/available-timeslots
   */
  export namespace get_available_timeslots {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = AvailableTimeslotsRequest;
    export type RequestHeaders = {};
    export type ResponseBody = GetAvailableTimeslotsData;
  }

  /**
   * @description Start the scheduler to periodically check for earlier slots
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name start_scheduler
   * @summary Start Scheduler
   * @request POST:/routes/start-scheduler
   */
  export namespace start_scheduler {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = StartSchedulerData;
  }

  /**
   * @description Stop the scheduler
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name stop_scheduler
   * @summary Stop Scheduler
   * @request POST:/routes/stop-scheduler
   */
  export namespace stop_scheduler {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = StopSchedulerData;
  }

  /**
   * @description Get the current status of the scheduler
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name get_scheduler_status
   * @summary Get Scheduler Status
   * @request GET:/routes/scheduler-status
   */
  export namespace get_scheduler_status {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = GetSchedulerStatusData;
  }

  /**
   * @description Set the interval for running the scheduler task
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name set_interval
   * @summary Set Interval
   * @request POST:/routes/set-interval
   */
  export namespace set_interval {
    export type RequestParams = {};
    export type RequestQuery = {
      /** Interval Seconds */
      interval_seconds: number;
    };
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = SetIntervalData;
  }

  /**
   * @description Run the earlier slots check immediately
   * @tags dbtn/module:schedulers, dbtn/hasAuth
   * @name run_now
   * @summary Run Now
   * @request POST:/routes/run-now
   */
  export namespace run_now {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = RunNowData;
  }

  /**
   * @description Accept an earlier slot notification and update the appointment.
   * @tags dbtn/module:accept_slot, dbtn/hasAuth
   * @name accept_earlier_slot
   * @summary Accept Earlier Slot
   * @request POST:/routes/accept-earlier-slot/{notification_id}
   */
  export namespace accept_earlier_slot {
    export type RequestParams = {
      /** Notification Id */
      notificationId: string;
    };
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = AcceptEarlierSlotData;
  }

  /**
   * @description Find new available earlier slots for appointments
   * @tags dbtn/module:find_slots, dbtn/hasAuth
   * @name find_new_slots
   * @summary Find New Slots
   * @request POST:/routes/find-new-slots
   */
  export namespace find_new_slots {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = AppointmentIdsRequest;
    export type RequestHeaders = {};
    export type ResponseBody = FindNewSlotsData;
  }

  /**
   * @description Check for earlier available slots for appointments where the customer has opted in. This would typically be called by a scheduled job.
   * @tags dbtn/module:check_slots, dbtn/hasAuth
   * @name check_earlier_slots_v2
   * @summary Check Earlier Slots V2
   * @request POST:/routes/check-earlier-slots-v2
   */
  export namespace check_earlier_slots_v2 {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = CheckEarlierSlotsV2Data;
  }

  /**
   * @description Get all earlier slot notifications for a specific user. The _t parameter is a cache busting mechanism and is ignored.
   * @tags dbtn/module:user_notifications, dbtn/hasAuth
   * @name get_user_notifications
   * @summary Get User Notifications
   * @request GET:/routes/user-notifications
   */
  export namespace get_user_notifications {
    export type RequestParams = {};
    export type RequestQuery = {
      /** Userid */
      userId: string;
      /**  T */
      _t?: string | null;
    };
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = GetUserNotificationsData;
  }

  /**
   * No description
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name analyze_code_health
   * @summary Analyze Code Health
   * @request GET:/routes/analyze
   */
  export namespace analyze_code_health {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = AnalyzeCodeHealthData;
  }

  /**
   * No description
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name get_health_check_history
   * @summary Get Health Check History
   * @request GET:/routes/health-history
   */
  export namespace get_health_check_history {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = GetHealthCheckHistoryData;
  }

  /**
   * No description
   * @tags noauth, dbtn/module:code_history, dbtn/hasAuth
   * @name analyze_firestore_usage
   * @summary Analyze Firestore Usage
   * @request GET:/routes/firestore-analysis
   */
  export namespace analyze_firestore_usage {
    export type RequestParams = {};
    export type RequestQuery = {};
    export type RequestBody = never;
    export type RequestHeaders = {};
    export type ResponseBody = AnalyzeFirestoreUsageData;
  }
}
