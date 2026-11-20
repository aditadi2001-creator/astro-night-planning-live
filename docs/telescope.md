# Live telescope: how to connect

The Sky page's **Telescope** tab shows where your mount points (a green ring on the sky) and a
HUD with altitude/azimuth, RA/Dec (J2000 and of date), hour angle, pier side, tracking state,
time to the meridian, NINA's meridian-flip countdown, time until it drops below your horizon,
rotator angle and the offset from the selected object.

The connection is **read-only**. Control appears only after you tick **Enable control** (off
again on every visit), and every action asks for confirmation: GoTo, sync, stop, park/unpark,
tracking on/off and, with NINA, plate-solve centring, rotation, setting a sequence target, loading
a saved sequence and sending to the framing assistant. Flip, connect, starting a sequence and
every other command are never sent (allow-lists in `src/lib/telescope/allow.ts` and
`serial.ts`).

## Four ways to connect

| Choice        | What it talks to                                                                           | Best for                                        |
| ------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **NINA**      | NINA's Advanced API plugin (2.2.x, NINA 3.2+), port 1888                                   | Imaging rigs: plate-solve centring, sequences   |
| ASCOM Alpaca  | Any Alpaca device, or ASCOM Remote (port 11111) in front of any ASCOM driver               | Windows rigs without NINA, Alpaca-native mounts |
| **USB cable** | The mount's hand controller directly (Web Serial: Chrome or Edge on a computer), 9600 baud | A laptop at the mount, nothing else installed   |
| Simulator     | A pretend mount at your site                                                               | Trying everything safely                        |

USB cable protocols: **LX200** (Meade LX200/Autostar, OnStep, iOptron and others in LX200 mode)
and **NexStar** (Celestron NexStar/StarSense hand controllers and Sky-Watcher SynScan hand
controllers, which speak the same commands). Most hand controllers work in coordinates of date
(JNow): leave "The mount is set to J2000" off unless you set it so. Close NINA, the ASCOM driver
or the SynScan app first: only one program can hold the port.

## GoTo that lands on the object

- **Safety first:** a GoTo is refused within 15° of the Sun (when it is up) unless you tick that a
  certified full-aperture solar filter is fitted, and refused below the horizon; it warns when the
  target is behind your own horizon (trees, buildings), under 15°, or about to cross the meridian
  (a flip will follow). `src/lib/telescope/safety.ts`, tests in `tests/mount-control.test.ts`.
- **With NINA, "Slew and centre"** asks NINA to slew, take a frame, plate-solve and re-slew until
  the target is within NINA's centring tolerance (`/equipment/mount/slew?center=true`); **"Centre
  and rotate"** also turns the rotator to the camera frame's position angle (`rotate=true`,
  `rotationAngle`). This is the most exact pointing possible: it does not depend on the mount's
  alignment model.
- **Without NINA** the mount's own pointing is used; the HUD shows how far the telescope is from
  the selected object and in which direction. Centre it (eyepiece or camera), then **Sync** so the
  next GoTo is better.
- **Into NINA's sequence:** _Read NINA's sequence_ lists the target containers of the sequence open
  in the Advanced Sequencer; _Set … as the target_ puts the selected object (J2000, with the camera
  frame's position angle) into the chosen container (`/sequence/set-target`). _Saved sequences_
  loads one of NINA's saved sequences first. Then start the sequence in NINA. The app never starts
  a sequence by itself.

## Five steps

1. **Turn on the API.**
   - NINA: Plugins → Available → install **Advanced API**, restart NINA, switch the API on and keep
     port **1888**.
   - ASCOM: start **ASCOM Remote** (port **11111**) and tick "Enable CORS" (allowed origins `*`) in
     its setup. Any other Alpaca device works too.
2. **Connect the mount** in NINA (Equipment → Mount) or in the ASCOM driver, as you normally do.
3. **Find the computer's address.** On the mini PC: `ipconfig` → IPv4 address, e.g.
   `192.168.1.20`. Your phone or laptop must be on the same Wi-Fi.
4. **Chrome or Edge (desktop or Android):** Sky → Telescope → NINA or ASCOM Alpaca, type the address
   (and the Alpaca device number, usually 0), press **Connect** and allow the "local network"
   prompt.
5. **Safari, iPhone, iPad or Firefox:** these block a secure web page from talking to `http://`
   addresses on your network. Run the bridge on the mini PC instead (needs
   [Node.js](https://nodejs.org) 18+ and a build of the app):

   ```
   node tools/bridge/bridge.mjs --dist dist
   ```

   Open `http://192.168.1.20:8080` on the phone, then Telescope → NINA (or Alpaca) → tick
   **Through the bridge** → Connect. Add `--allow-control` only if you want slew/sync to work
   through it; without it the bridge refuses every command. Other options: `--port`,
   `--nina host:port`, `--alpaca host:port`.

**Never forward ports 1888, 11111 or 8080 to the internet.** NINA's API has no password, and
its commands are plain web requests.

## When it does not work

| Message                                      | What to check                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Could not reach NINA at …"                  | NINA open? Advanced API on? Same Wi-Fi? Windows firewall allowing port 1888?         |
| "… may block a secure page …"                | Use Chrome/Edge and allow the prompt, or use the bridge (step 5).                    |
| "NINA is running, but no mount is connected" | Connect the mount in NINA.                                                           |
| "The Alpaca telescope is not connected"      | Connect it in the driver / ASCOM Remote.                                             |
| "… bridge could not reach 127.0.0.1:1888"    | The bridge runs, NINA does not answer on that computer: start NINA or pass `--nina`. |
| "Blocked: … is not on the allow-list"        | Tick **Enable control** (and start the bridge with `--allow-control`).               |

No telescope at hand? Pick **Simulator**: a pretend mount at your site that starts parked at the
pole, slews at 4°/s and takes the pier side a real equatorial mount would.

## Notes for developers

- NINA reports RA/Dec in the mount's own epoch (`Coordinates.Epoch`, usually JNOW); the app
  converts to J2000 with Astronomy Engine's precession + nutation and shows both. NINA's slew
  and sync take **J2000 degrees** (`ninaAPI` `Mount.cs`).
- Alpaca: `equatorialsystem` 1 = topocentric (JNow), 2 = J2000; RA in hours. The app reads
  `devicestate` when the driver has it, else the single properties.
- Tested here against the simulator and a mock NINA server that follows `ninaAPI`'s
  `api_spec.yaml` (direct and through the bridge). Not yet tested against a real NINA or a real
  Alpaca driver.
