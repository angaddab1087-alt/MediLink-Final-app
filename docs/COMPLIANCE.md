# MediLink compliance notes

MediLink handles health data in India. This page maps the main legal duties to what the code does. It is a project document, not legal advice.

## DPDP Act 2023 (Digital Personal Data Protection)

| Duty | How MediLink handles it |
|---|---|
| Consent for a stated purpose | Sign-up ends with a declaration saved with a timestamp. Each hospital gets its own consent, which the patient can withdraw from Profile. |
| Right to access and to a copy | Patients see their visits, Drive and an access history (who opened what, including admin views with the reason). `POST /api/me/data-requests {kind:"export"}` returns all of their data as JSON. |
| Right to erasure | `POST /api/me/data-requests {kind:"erasure"}` is recorded and answered "Refused (legal hold)" for medical records, because hospitals must keep them for a legal period (below). Account details can be removed after that period. |
| Breach notice to the Data Protection Board within 72 hours | Owner Console → Compliance: each incident marked "personal data involved" shows a 72-hour countdown and a "Board reported" button. |
| Data minimisation | Raw Aadhaar numbers are never stored, only a verification result. The Owner Console shows platform metadata only. |

## CERT-In directions (April 2022)

| Duty | How MediLink handles it |
|---|---|
| Report cyber incidents within 6 hours | Owner Console → Compliance starts a 6-hour countdown when an incident is opened, with a "CERT-In reported" button. |
| Keep logs for 180 days | The audit log is permanent (database triggers block deletion); the retention setting cannot go below 180 days. |
| Synchronised clocks | All times are stored by PostgreSQL (`now()`); run the server with NTP. |

## Medical records (NMC / Indian Medical Council regulations)

Records are kept for at least 3 years (the default setting is 10). Prescriptions and report versions cannot be edited or deleted. A correction is a new version with a reason and the old version stays visible to the patient.

## ABDM

ABHA, consent artefacts and DigiLocker are simulated (they need sandbox approval). The data model keeps the ABHA reference and consent per hospital so the real gateway can be connected later.
