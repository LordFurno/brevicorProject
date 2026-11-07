Brevicor Telemedicine Module
Version 1.2 · November 2026 · Proposed MVP
1. Product Vision
Brevicor Telemedicine will enable physicians to conduct video and telephone consultations directly from their existing Electronic Health Record (EHR) systems.
The goal is to provide a simple, browser-based telemedicine experience requiring minimal infrastructure and no additional software installation. Patients with scheduled appointments can join video consultations using a secure invitation link, while physicians can initiate telephone calls directly from the EHR.
Twilio (or Similar)  will provide managed video conferencing, VoIP/PSTN connectivity, and transcription capabilities.
The solution will be EHR-agnostic and FHIR-native, using an integration layer that exposes standardized HL7 FHIR R4 resources regardless of whether the underlying EHR supports FHIR, uses proprietary APIs, or relies on synthetic test data.
As an Ontario-based healthcare technology provider, Brevicor is committed to complying with Ontario's Personal Health Information Protection Act (PHIPA) and prioritizing Canadian data residency.
Objectives
Enable physicians to initiate video or telephone consultations directly from scheduled appointments.
Allow patients to join video consultations without creating accounts or installing applications.
Provide a virtual waiting room with patient arrival notifications.
Support browser-based VoIP calls to patients' PSTN telephone numbers.
Generate consultation transcripts and associate them with the appropriate clinical encounter.
Minimize infrastructure by leveraging Twilio's (or similar) managed communication services.
Provide an intuitive experience across desktop, iPhone, and Android browsers.
Maintain tenant isolation, security, auditability, and PHIPA compliance.

2. Functional Requirements
Module
Requirements
Mock FHIR Provider
Store synthetic clinical data in a Brevicor-managed datastore and expose it through a FHIR R4-compatible API for development, testing, and demonstrations.
Appointment Management
Support Video and Telephone appointment types. Generate secure video invitations when appointments are scheduled. Handle cancellations and rescheduling.
Patient Authentication
Patients do not require accounts. Verify identity using an appointment-specific secure link and date of birth, with additional verification controls where required.
Video Waiting Room
Allow patients to enter up to 15 minutes before their appointment. Notify early arrivals and handle late arrivals according to configurable clinic policies.
Physician Notifications
Notify authenticated physicians when patients arrive. Send email/SMS notifications when physicians are offline, without including patient-identifying information.
Video Consultation
Use Twilio Video for browser-based audio/video. Physicians admit waiting patients. Support mute, camera controls, disconnect, reconnect, and session termination.
Telephone Consultation
Use Twilio Voice to initiate outbound PSTN calls from the physician's browser. Support caller ID, number selection, call status, mute, hang-up, and failed-call handling.
Transcription
Use Twilio-supported transcription capabilities for video and telephone consultations. Generate speaker-attributed transcripts where supported, with appropriate consent controls.
Clinical Documentation
Associate transcripts with the appropriate clinical encounter using FHIR DocumentReference. Allow physician review and correction.
Session Management
Track waiting, active, disconnected, completed, and failed sessions. Support multiple communication sessions within one clinical encounter.
Administration
Configure waiting room policies, notifications, caller ID, transcription preferences, and clinic-specific settings.
Security and Privacy
Enforce physician authentication, patient verification, tenant isolation, encrypted communications, consent management, and audit logging.

2.1 EHR Integration Layer
The Telemedicine Module must be independent of the underlying EHR implementation and interact exclusively with standardized HL7 FHIR R4 resources.
The EHR Integration Layer will provide a consistent FHIR interface regardless of whether the underlying EHR natively supports FHIR, exposes proprietary APIs, or uses synthetic test data.
Requirements
Expose standardized FHIR R4 resources, including Patient, Practitioner, Appointment, Encounter, and DocumentReference.
Support standard FHIR REST operations for retrieving, searching, creating, and updating resources, where supported.
Support three integration modes:
Native FHIR: Access FHIR resources from an EHR that already supports FHIR R4.
EHR Adapter: Transform proprietary EHR APIs and data structures into FHIR R4 resources.
Mock FHIR Provider: Store synthetic clinical data in a Brevicor-managed datastore and expose it through a FHIR R4-compatible API.
Ensure all three integration modes expose consistent FHIR resource structures and API behaviour.
Support bidirectional transformations where the underlying EHR permits updates.
Handle differences in EHR capabilities, including read-only resources and unsupported operations.
Manage authentication, authorization, tenant isolation, and EHR-specific credentials within the integration layer.
Validate resources against applicable FHIR R4 specifications.
Provide consistent error handling using FHIR OperationOutcome resources.
Prevent the Telemedicine Module from accessing proprietary EHR APIs or databases directly.
Architectural principle: The Telemedicine Module consumes FHIR R4 resources exclusively. The EHR Integration Layer is responsible for ensuring that every supported EHR presents a consistent FHIR interface.
2.2 Video Consultation Workflow
A video appointment is retrieved through the EHR Integration Layer, and the patient receives a secure invitation link through email or SMS.
The patient opens the link and verifies their identity using their date of birth.
Patients arriving more than 15 minutes early are informed when they can join. Late arrivals are handled according to clinic policy.
The patient enters a virtual waiting room and can test their camera and microphone.
The physician receives an in-app notification or an email/SMS notification if offline.
The physician selects the waiting patient and initiates the video consultation.
Both participants communicate through Twilio Video using their browsers.
Either participant can disconnect. Interrupted consultations support reconnection.
On completion, the transcript is processed and associated with the clinical encounter through the EHR Integration Layer.
2.3 Telephone Consultation Workflow
The physician opens a scheduled telephone appointment in the EHR.
The system retrieves the patient's telephone number through the EHR Integration Layer.
The physician confirms the number and selects Call Patient.
Twilio Voice connects the physician's browser audio to the patient's PSTN number.
The physician conducts the consultation using browser-based audio controls.
Transcription is activated when the required consent or authorization has been established.
On completion, the transcript is processed and associated with the clinical encounter through the EHR Integration Layer.
2.4 Transcription Requirements
Support transcription of both video and telephone consultations.
Capture both participants' speech with speaker identification where supported.
Support starting, stopping, and disabling transcription.
Obtain and record applicable patient consent or authorization.
Process transcripts asynchronously without delaying consultation completion.
Store transcripts securely and associate them with the correct clinical encounter.
Allow physicians to review and correct transcripts.
Do not retain raw audio/video recordings by default beyond what is technically necessary for authorized transcription.
Support future integration with Brevicor's AI Medical Document Summarization and AI Scribe modules.
3. Non-Functional Requirements
EHR independence: The Telemedicine Module must function without knowledge of the underlying EHR implementation, data structures, or API protocols.
FHIR compatibility: All clinical resources exposed to the Telemedicine Module must conform to HL7 FHIR R4 specifications.
Data residency: Application infrastructure, PostgreSQL, logs, and stored transcripts must remain in approved Canadian infrastructure. Twilio media routing, processing, and transcription residency must be validated before production deployment.
PHIPA compliance: Implement appropriate technical, administrative, and contractual safeguards, including privacy impact assessments and third-party service provider reviews.
Browser compatibility: Support current versions of Chrome, Safari, and Edge, including Safari on iPhone and Chrome on Android.
No patient installation: Patients must not require an application, browser extension, or account.
Performance: Target video connection establishment within 10 seconds under normal conditions and waiting room notifications within 5 seconds.
Reliability: Support reconnection, interrupted sessions, failed calls, duplicate event handling, and transcription retries.
Security: Encrypt communications, use short-lived access tokens, verify Twilio webhooks, enforce authorization, and prevent cross-tenant access.
Scalability: Support multiple clinics, EHR providers, and simultaneous consultations without requiring Brevicor-managed media servers.
Observability: Monitor session failures, call durations, connection quality, transcription failures, and Twilio usage without exposing PHI in logs.
Accessibility: Provide responsive, accessible interfaces requiring minimal training.
Clinical safety: Transcripts must be identified as unverified until reviewed by an authorized clinician.
4. Suggested API Contracts
Telemedicine Base URL: /api/telemedicine/v1
FHIR Base URL: /api/fhir/R4
All physician-facing APIs require Brevicor authentication. Patient-facing APIs use restricted appointment-specific credentials.
A. Create Video Consultation
POST /api/telemedicine/v1/sessions
Request:
{
  "appointment_id": "Appointment/98765",
  "type": "video"
}
Response:
{
  "id": "session_123",
  "status": "scheduled",
  "type": "video",
  "invitation_url": "https://brevicor.example/visit/secure-token",
  "appointment_id": "Appointment/98765"
}
The API creates or retrieves the appointment's telemedicine session and generates a secure invitation.
B. Verify Patient and Join Waiting Room
POST /api/telemedicine/v1/sessions/{id}/verify
Request:
{
  "invitation_token": "secure-token",
  "date_of_birth": "1980-05-15"
}
Response:
{
  "status": "verified",
  "waiting_room_access": true,
  "appointment_time": "2026-11-10T15:30:00Z",
  "patient_session_token": "short-lived-token"
}
The API validates the invitation, verifies patient information, and issues restricted credentials.
C. Get Physician Waiting Room
GET /api/telemedicine/v1/waiting-room
Response:
{
  "patients": [
    {
      "session_id": "session_123",
      "appointment_id": "Appointment/98765",
      "patient_id": "Patient/12345",
      "appointment_time": "2026-11-10T15:30:00Z",
      "status": "waiting",
      "waiting_since": "2026-11-10T15:25:00Z"
    }
  ]
}
Only authorized physicians and clinic staff may retrieve waiting patient information.
D. Start Video Consultation
POST /api/telemedicine/v1/sessions/{id}/start
Response:
{
  "session_id": "session_123",
  "status": "active",
  "provider": "twilio",
  "room_name": "brevicor-session-123",
  "access_token": "short-lived-twilio-token"
}
The API validates physician authorization and issues credentials for the Twilio Video session.
E. Initiate Telephone Consultation
POST /api/telemedicine/v1/calls
Request:
{
  "appointment_id": "Appointment/98765",
  "phone_number": "+15195550123"
}
Response:
{
  "id": "call_123",
  "session_id": "session_456",
  "status": "initiating",
  "provider": "twilio"
}
The API initiates a Twilio Voice call connecting the physician's browser to the patient's telephone number.
F. End Consultation
POST /api/telemedicine/v1/sessions/{id}/end
Response:
{
  "session_id": "session_123",
  "status": "completed",
  "duration_seconds": 1200,
  "transcription_status": "processing"
}
Ending a communication session must not automatically mark the clinical Encounter as completed.
G. Retrieve Consultation Transcript
GET /api/telemedicine/v1/sessions/{id}/transcript
Response:
{
  "session_id": "session_123",
  "status": "completed",
  "encounter_id": "Encounter/45678",
  "transcript": [
    {
      "speaker": "physician",
      "timestamp": "00:00:05",
      "text": "How are you feeling today?"
    },
    {
      "speaker": "patient",
      "timestamp": "00:00:09",
      "text": "I have been having difficulty sleeping."
    }
  ],
  "document_reference": "DocumentReference/12345"
}
Transcripts are accessible only to authorized users.
H. FHIR Integration API
The EHR Integration Layer will expose a standardized FHIR R4 REST API.
Base URL: /api/fhir/R4
FHIR Resource
Required Operations
Purpose
Patient
Read, Search
Retrieve patient demographics, date of birth, and contact information.
Practitioner
Read, Search
Retrieve physician information.
Appointment
Read, Search
Retrieve scheduled consultations and appointment details.
Encounter
Read, Search, Create, Update
Associate telemedicine sessions with clinical encounters.
DocumentReference
Read, Search, Create
Associate consultation transcripts and clinical documentation with encounters.
Binary
Read, Create (Optional)
Store or retrieve transcript content where supported.

Additional resources such as PractitionerRole, Organization, and Consent may be supported as required.
Example FHIR Operations
GET /api/fhir/R4/Patient/12345

GET /api/fhir/R4/Practitioner/67890

GET /api/fhir/R4/Appointment/98765

GET /api/fhir/R4/Appointment?actor=Practitioner/67890&date=ge2026-11-10&date=lt2026-11-11

GET /api/fhir/R4/Encounter/45678

POST /api/fhir/R4/Encounter

POST /api/fhir/R4/DocumentReference
All responses must conform to FHIR R4 resource structures.
Supported operations must be discoverable through the FHIR CapabilityStatement.
Integration Modes
1. Native FHIR Provider
For EHR systems exposing FHIR R4 APIs, the integration layer will proxy or forward supported FHIR requests to the underlying EHR.
The layer remains responsible for authentication, authorization, tenant routing, and consistent error handling.
2. Proprietary EHR Adapter
For EHR systems without FHIR support, Brevicor will implement an adapter that:
Receives standard FHIR requests.
Translates them into the EHR's proprietary API operations.
Retrieves or updates data through the EHR API.
Converts proprietary responses into valid FHIR R4 resources.
Returns standardized FHIR responses to the Telemedicine Module.
The adapter must also support reverse transformation for write operations where permitted.
3. Mock FHIR Provider
For development, testing, and demonstrations, Brevicor will provide a mock FHIR provider.
The mock provider will:
Store synthetic patient, practitioner, appointment, and encounter data in a Brevicor-managed datastore.
Expose the synthetic data through standard FHIR R4 REST endpoints.
Support required FHIR read, search, create, and update operations.
Allow developers to seed and reset synthetic datasets.
Simulate appointment workflows and clinical documentation.
Operate without requiring connectivity to a production EHR.
The mock provider must use the same FHIR API contract as production integrations, allowing the Telemedicine Module to operate without code changes.
Handling Unsupported EHR Operations
An EHR may not support every FHIR operation.
For example, an EHR might expose appointments and patient demographics but not support creating a DocumentReference.
The integration layer must:
Expose supported capabilities through a FHIR CapabilityStatement.
Return appropriate FHIR OperationOutcome responses for unsupported operations.
Optionally store clinical documents in a Brevicor-managed secure document store when the EHR cannot persist them.
Track synchronization status and identify the authoritative storage location.
Prevent silent data loss when an underlying EHR operation fails.
I. Twilio Webhooks
POST /api/telemedicine/v1/webhooks/twilio
Handle events such as:
Video participant joined or disconnected.
Video room completed.
Telephone call answered, failed, or completed.
Recording or transcription processing completed or failed.
Webhook handlers must verify Twilio signatures, process duplicate events safely, and update session state asynchronously.
5. Recommended Technology Choices
Frontend: Next.js, React, TypeScript, responsive web interfaces.
Backend: Node.js/TypeScript REST APIs hosted on Vercel.
Operational Database: PostgreSQL for session state, invitation metadata, notification status, and provider references.
Clinical Integration Standard: HL7 FHIR R4.
EHR Integration Layer: FHIR R4-compatible API gateway supporting native FHIR, proprietary EHR adapters, and synthetic FHIR data.
Mock FHIR Provider: Brevicor-managed datastore exposing synthetic clinical data as FHIR R4 resources.
Video Conferencing: Twilio Programmable Video with managed WebRTC connectivity.
Telephone Calling: Twilio Programmable Voice and Voice JavaScript SDK for browser-to-PSTN calls.
Transcription: Twilio-supported transcription services or Twilio Media Streams integrated with an approved transcription processor.
Notifications: Twilio SMS and an approved email delivery service.
Asynchronous Processing: Durable queue or managed background processing for transcription, notifications, and webhook handling.
Hosting: Vercel for frontend and APIs; Twilio for managed communication infrastructure.
System Architecture
                     Brevicor Telemedicine
                       (Next.js / React)
                              |
                       Telemedicine API
                              |
              +---------------+---------------+
              |               |               |
         FHIR R4 API        Twilio         PostgreSQL
              |          Video/Voice      Session Data
              |
        EHR Integration Layer
              |
      +-------+---------+----------+
      |                 |          |
  Native FHIR       Proprietary   Mock FHIR
   Provider         EHR Adapter    Provider
      |                 |          |
  FHIR-Compliant     Non-FHIR     Synthetic
      EHRs             EHRs       Test Data
Architectural Principle: The Telemedicine Module communicates exclusively with the FHIR R4 API for clinical data. The EHR Integration Layer handles all EHR-specific integration logic.
The EHR Integration Layer should be implemented as a reusable Brevicor platform component, allowing other modules such as Referral Management, Questionnaire Management, and AI Scribe to use the same FHIR interface.

6. MVP Acceptance Criteria
Physicians can initiate video and telephone consultations directly from scheduled appointments.
Patients can join video consultations through secure links without creating accounts or installing software.
Patient identity verification, waiting room access, and physician admission work correctly.
Physicians receive patient arrival notifications.
Video consultations work on supported desktop, iPhone, and Android browsers.
Physicians can initiate PSTN calls directly from their browsers.
Consultation sessions support disconnect/reconnect and appropriate failure handling.
Both video and telephone consultations support authorized transcription.
Transcripts are associated with the correct clinical encounter through FHIR R4 resources.
The Telemedicine Module consumes only FHIR R4 resources for clinical information.
Native FHIR, proprietary EHR, and mock providers expose the same supported FHIR API contract.
The Telemedicine Module operates with any supported provider without application code changes.
Proprietary EHR adapters correctly transform clinical data into valid FHIR R4 resources.
Supported write operations correctly translate FHIR resources into the underlying EHR's required format.
The mock provider stores synthetic clinical data and exposes it through FHIR R4 REST endpoints.
Developers can seed, reset, and query synthetic clinical data without connecting to a live EHR.
Unsupported EHR operations are detected and handled without silently losing clinical data.
FHIR resources are validated, and unsupported operations return appropriate FHIR error responses.
Provider capabilities are discoverable through a FHIR CapabilityStatement.
Resource identifiers and references are correctly mapped between Brevicor and external EHR systems.
Transcription failures do not prevent consultations from proceeding.
Patient data and consultation records are isolated by clinic/tenant.
All communication access is authenticated or appropriately verified and audited.
No unnecessary raw audio/video recordings are retained.
Canadian data residency and PHIPA-related requirements are assessed and validated before production use.
No Brevicor-managed video conferencing or PBX servers are required.

7. Deliverables
System Architecture Diagram.
Working Source Code (Git Repository).
FHIR R4 EHR Integration Layer.
Native FHIR Provider Adapter.
Mock FHIR Provider with Synthetic Clinical Data.
FHIR Resource Mapping and Adapter Development Guide.
Twilio Configuration and Integration Guide.
Setup / Installation Guide.
Operating and Administration Guide.
Open Source Contribution Guide.
Unit and Component (API) Tests.
FHIR API Conformance and Integration Tests.
End-to-End Video and Telephone Consultation Tests.
Working Demo using the Mock FHIR Provider and Twilio cloud services.

