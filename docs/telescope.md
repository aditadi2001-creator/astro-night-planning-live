# Live telescope: how to connect

The Sky page's **Telescope** tab shows where your mount points (a green ring on the sky) and a
HUD with altitude/azimuth, RA/Dec (J2000 and of date), hour angle, pier side, tracking state,
time to the meridian, NINA's meridian-flip countdown, time until it drops below your horizon,
rotator angle and the offset from the selected object.

The connection is **read-only**. Slew and sync appear only after you tick **Enable control**
(off again on every visit), and each one asks for confirmation. Park, flip, connect and every
other command are never sent (path allow-list in `src/lib/telescope/allow.ts`).

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
