# Re-MIND-eЯ — Project Context

Re-MIND-eЯ is a high-reliability, patient-centric medication management and adherence platform. The system is designed to support individuals (especially elderly patients) in managing their medication routines, while providing their family members, friends, and professional caregivers with real-time monitoring, alerts, and escalation workflows to ensure no critical doses are missed.

## Vision and Objectives

- **Patient Safety**: Reduce the risk of missed, double, or late medication doses.
- **Shared Care (Care Circle)**: Enable a support network of caregivers to monitor compliance, receive alerts, and coordinate interventions.
- **Interface Options**: Provide a clean standard interface alongside an **Elderly Mode Layout** with high visibility, large touch targets, and voice/simple interaction paths.
- **Omnichannel Delivery**: Sync reminders across Web PWA, SMS, push notifications, and a dedicated **Telegram Bot**.
- **Auditability**: Maintain a cryptographically secure audit trail of dose confirmations, caregiver changes, and permissions.

## Core Domain Concepts

1. **Patient**: The individual whose medication routines are tracked.
2. **Caregiver**: A trusted supporter linked to the patient's Care Circle who monitors adherence.
3. **Care Circle**: A many-to-many coordination layer linking patients to their caregivers.
4. **Reminder Event**: An instance of a scheduled dose. Can be *real* (database record) or *virtual* (client-side prediction for future daily slots).
5. **Escalation**: The process where a missed reminder moves from patient alerts to caregiver notifications after a predefined cooldown window.
6. **Health Vault**: A secure space where patient documents (prescriptions, scan reports) are uploaded and shared selectively.
