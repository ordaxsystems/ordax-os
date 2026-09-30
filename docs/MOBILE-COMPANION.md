# OrdaX Mobile Companion

Status: **PRE-MVP CONTRACT FOUNDATION — MOBILE RUNTIME POST-MVP**

OrdaX Mobile is a first-class OrdaX client and can also act as a **capability provider** for
other authorized OrdaX devices.

The phone is not a generic remote peripheral. Each capability is explicit, scoped, revocable
and visible to the user.

## Initial capabilities

- microphone stream;
- camera stream;
- camera capture;
- current location;
- opt-in device presence/location;
- orientation and motion sensors;
- file/share handoff;
- notifications.

The registry is versioned. NFC, Bluetooth, UWB and future platform utilities may be added later
without changing product identity.

## Voice example

```text
phone microphone
 -> Android/iOS permission
 -> OrdaX consent screen
 -> short-lived capability grant
 -> encrypted live media session
 -> OrdaX Intelligence voice input
```

The user may issue a voice command from the phone to the same OrdaX account/Space even when the
notebook is only one of several active clients.

## Webcam example

```text
phone camera
 -> explicit foreground grant on phone
 -> encrypted media session
 -> Desktop/Native media capability
 -> future virtual-camera adapter
 -> meeting/app
```

The virtual-camera adapter is a Desktop/Native capability, not a special mobile application fork.

## Find my devices

Device finding is account-scoped and opt-in.

A device may publish bounded presence metadata and, only after explicit permission, coarse or precise
location. Exact location is never enabled merely because the user signed in.

The locator is for devices owned by the same account or explicitly shared through a Space. It is not
a general-purpose tracker.

Future local proximity may use mDNS, Bluetooth LE or UWB where platforms support it.

## Consent

Camera, microphone, motion and one-shot location are foreground capabilities. The user sees which
OrdaX device/app requested access and can stop the session from the phone.

Persistent device-presence/location is a separate opt-in setting and must also respect Android/iOS
background-location rules.

No app can create authority by claiming that it needs a sensor. The platform adapter and OrdaX grant
must both allow it.

## Transport

The contract does not hardcode a media vendor. Live audio/video should use an encrypted realtime
transport such as WebRTC or an equivalent provider-neutral implementation.

Cloud recording is not required for webcam/microphone use. A relay may be used when direct peer
connectivity is unavailable, but the permission model is unchanged.

## Independence

The phone does not require the notebook to be powered on to use account, cloud, notifications,
orders, device presence or other cloud-backed OrdaX services.

When the phone is serving its camera/microphone specifically to a notebook application, that
receiving notebook obviously needs to be online for that session. This does not make the phone or
the OrdaX account dependent on the notebook.

## MVP boundary

This is architecture and contract work only. It does not ship an Android APK, virtual camera driver,
live microphone relay or device-locator runtime in the first USB.

It exists now so those capabilities can be delivered later through normal OrdaX app/runtime updates
without redesigning Account, Spaces, permissions or Device Agent.
