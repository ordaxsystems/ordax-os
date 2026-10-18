# Meridian First Run and real Native emulator

Source candidate; no physical-media or Stable/MVP promotion claim.

## Verified in the real browser

The Windows emulator serves the actual Native entry:
`/system/composition/native/index.html`. The former independently mounted
emulator onboarding and subsequent Web preview handoff were removed.

The canonical Native renderer and stylesheet now use Meridian directly:
warm canvas, dark contextual rail, editorial hierarchy, canonical brand symbol,
shared type, surfaces, borders and clay actions. Legacy First Run gradient/glass
styling was replaced in its owner rather than covered by another stylesheet.

A real browser session completed welcome, region, network, local security,
local-only account, privacy, device-name fallback and completion. English and
America/Manaus were selected through UI controls; the Native desktop and clock
used them. A full page reload retained completion, locale and time zone, with
no onboarding dialog. The explicit development reset was then used to leave
welcome available for review, preserving preferences.

Native hardware APIs and privileged WebKit bridges were unavailable in Windows,
not represented by fake grants. Native controls retain their capability states.

## Responsive observations

- Notebook: measured CSS viewport 1440 × 900; shared two-column shell.
- Narrow: measured CSS viewport approximately 390 × 843; all eight step markers
  remained on one row at the same vertical position. Progress height ~137px;
  Continue remained visible with its lower edge ~829px inside the viewport.
- Screenshots are unmodified browser captures. The in-app browser zoom/capture
  scale can include surrounding canvas; CSS sizes above were measured from DOM.

![Native Meridian welcome](native-welcome-desktop.png)
![Narrow Native Meridian welcome](native-welcome-narrow.png)

## Automated verification

30 Node tests passed across First Run semantics, localization, capability refusal,
Native bridge/App Data boundaries, SSOT ownership and emulator persistence through
the real Native adapters. Invalid/cross-origin writes, conflicting completion and
unreadable saved state were rejected. Hardware endpoints remain unavailable.

The Python Native-host suite was attempted on Windows: five cases require Linux
`fcntl` and were not counted as passes. The physical USB runtime was not changed.

The emulator browser smoke source was updated to follow the Native frame and
reload persistence; the observed end-to-end proof above used the real browser UI.

## Follow-up: network, security and account UX

The same Native renderer now presents unavailable capabilities as consistent
Meridian status panels with product-facing copy. Security still explicitly states
that the session lock does not encrypt USB files. Credential policy, legal consent,
authentication and hardware capability gates remain unchanged.

Account continuation is in the persistent footer alongside Back. Sign-in and
registration controls remain present and disabled when unsupported. The local
path was clicked in the actual emulator iframe and reached Privacy; Back returned
to Account. No credential was entered or created. Wi-Fi choices now expose their
selected state to assistive technology and use full-width rows; connection controls
stack on narrow viewports. The hardware-enabled Wi-Fi/credential paths were not
visually exercised because the emulator does not provide those capabilities.

Observed the actual emulator iframe at CSS 389 × 843: no horizontal overflow;
footer actions had bottom 829.29px, and the rightmost edge was 367.56px.
Updated Portuguese copy has corresponding English, Spanish, German and French
translations in the existing catalog. Verification: 25 Node tests passed (journey,
state, i18n, capabilities, Native emulator host); 3 Python credential-policy tests
passed. Syntax and whitespace checks passed. This does not replace the outstanding
Linux-only and physical-media validation described above.

![Account, desktop emulator](account-refined-desktop.png)
![Account, narrow emulator](account-refined-mobile.png)
![Network, desktop emulator](network-refined-desktop.png)
![Security, desktop emulator](security-refined-desktop.png)

## Follow-up: privacy, device name and completion

Privacy now places the real memory preference before explanatory information.
The native checkbox has an accessible switch name and description, a 44px label
hit area, keyboard focus styling and focus restoration after its existing rerender.
No default, permission, persistence or capture policy was changed. Browser review
read the existing enabled state; it did not toggle the user's privacy preference.
The informational USB/offline/internal-disk boundaries remain visible below it.

Device naming uses the same unavailable-capability panel as the other steps.
It continues to depend on the actual device-profile adapter and confirmed rename;
no local-only imitation was added. This emulator lacks that capability, so the
real rename path was covered by its existing adapter tests, not a hardware claim.

Completion now asks the user to review choices before entering. All application
selection counters and their read-only limitations remain in a native expandable
details element. Opening it in the actual emulator showed 0 verified independent
apps, 0 future candidates, 0 suppressed apps and 15 unverified distributions; no
apps were installed. No completion receipt was written during this follow-up.

Real iframe review: Privacy, device-name fallback and Ready; details opened and
closed through UI. At CSS 1440 x 900, Privacy and collapsed Ready fit the body
without vertical overflow (scrollHeight/clientHeight both 626px). At 389 x 843,
content scrolls inside the card, no horizontal overflow, and Ready footer buttons
remain visible at bottom 829.29px. The page was left on Ready for review.

Verification: 35 existing Node tests passed across journey ownership, localization,
privacy preference authority, device-profile rename, app-selection rules and
First Run state. MJS syntax and whitespace checks passed. The four translated
locales were updated in the existing catalog. Physical-media validation remains
outside this browser proof.

![Privacy, desktop emulator](privacy-refined-desktop.png)
![Privacy, narrow emulator](privacy-refined-mobile.png)
![Device name, desktop emulator](device-name-refined-desktop.png)
![Ready, desktop emulator](ready-refined-desktop.png)
![Ready, narrow emulator](ready-refined-mobile.png)
