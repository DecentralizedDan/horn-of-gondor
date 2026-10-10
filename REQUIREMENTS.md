# Horn of Gondor — MVP Requirements

## Purpose

Horn of Gondor is an open source VHF signal-reporting receiver. It will run unattended at home while the operator travels through the surrounding area and transmits with amateur-radio handheld transceivers.

The MVP has two goals:

1. Show whether a transmission reached the home receiver.
2. Provide repeatable relative measurements for comparing HTs, antennas, and other test conditions.

It is a receive-only system. It does not transmit or attempt to identify the
transmitting station. It records a short opening audio excerpt for public
playback.

## Receiver Hardware

- Raspberry Pi 3 Model B+
- Latest 64-bit Raspberry Pi OS
- RTL-SDR Blog V3:
  - R860 tuner
  - RTL2832U
  - 1 PPM TCXO
  - SMA connector
- The antenna supplied with the RTL-SDR for the MVP
- Home-network internet connection
- Wall power or a suitable power bank

A ham HT and DigiRig Mobile are available, but the RTL-SDR is the preferred receiver. Audio from an HT does not provide a reliable RF signal-strength measurement.

## Radio Configuration

- Receive analog FM voice transmissions.
- Operate on one configurable frequency between 144 and 148 MHz.
- Do not expose receiver configuration or administrative controls through the public website.
- Store configuration in a human-editable JSON file on the Pi.
- Make at least these values configurable:
  - Receive frequency as an integer or decimal number in MHz
  - RTL-SDR gain
  - Signal threshold in dBFS
  - Score range in decibels, defaulting to 50 dB
  - Minimum transmission duration
  - End-of-transmission grace period
  - Data-retention period
  - Audio enabled state, maximum excerpt duration, and retention period
  - Cloud endpoint and authentication credentials
- Disable automatic gain control and use fixed gain so measurements remain comparable.
- Use channelized raw IQ from `rtl_fm` at 48 kHz and calculate one relative
  power measurement every 100 ms.
- Restart `rtl_fm` after an unexpected exit and fail clearly after repeated
  startup failures.
- Treat measurements as relative rather than calibrated S-units.
- Provide a recalibration script for location, antenna, gain, and RF
  environment changes. It must print the exact receiver configuration fields
  and recommended values rather than editing `config.json` automatically.

The operator is responsible for selecting a lawful frequency appropriate to the local band plan and identifying amateur-radio transmissions as required.

## Transmission Detection

- Monitor continuously while the service is running.
- Recognize a transmission automatically when signal strength exceeds the configured threshold.
- Require a signal to last at least one second by default.
- End an event after the signal falls below the threshold for an implementation-defined grace period.
- Other users on the configured frequency may appear in the results. The MVP does not need to distinguish them.
- Save one result for every detected transmission.

Each result must include:

- Start timestamp
- Transmission duration
- Peak signal strength
- Average signal strength
- Human-readable relative score from 0 to 100

Calculate the relative score from peak and average strength:

1. Treat the configured detection threshold as 0.
2. Treat the threshold plus the configured score range as 100. The default
   score range is 50 dB.
3. Normalize peak and average strength separately within that range.
4. Weight normalized peak at 40% and normalized average at 60%.
5. Round the result to the nearest integer and clamp it from 0 through 100.

Duration does not affect the strength score. Reject configurations where the
threshold plus score range would exceed 0 dBFS.

## Local Storage and Reliability

- Store results locally on the Pi in SQLite.
- Preserve results while the internet connection is unavailable.
- Upload pending results automatically after connectivity returns.
- Avoid losing an accepted transmission if the cloud service is temporarily unavailable.
- Retain history for 180 days by default.
- Allow the retention period to be changed in the Pi's JSON configuration.
- Queue WAV preparation and upload state alongside each event.
- Upload audio before event metadata so a displayed result is immediately
  playable, then remove the successfully published local WAV.

## Cloud Service

- Use Cloudflare's free tier for the MVP.
- Prefer Cloudflare Workers and D1.
- Require authenticated requests when the Pi uploads results.
- Allow unauthenticated, read-only public access to result data.
- Do not require inbound connections or open router ports on the home network.
- Use a Cloudflare-provided public URL initially; a custom domain is not required.
- Support one receiver for the MVP.
- Store no receiver-location data.
- Store audio clips in Cloudflare R2, not D1.
- Retain audio for one day by default, independently of result history.

## Audio Recording and Playback

- Record mono FM audio from the same RTL-SDR IQ stream used for measurement.
- Use 16 kHz PCM WAV to avoid a separate encoder on the Raspberry Pi.
- Capture only the opening portion of a transmission, defaulting to 10 seconds.
- Make the maximum excerpt duration configurable from 1 through 30 seconds.
- Remove the first 200 ms from every recording to suppress the receiver's
  opening static burst.
- Trim the final 250 ms from complete recordings shorter than the configured
  maximum, but do not trim capped excerpts.
- Apply short edge fades, RMS normalization, and a soft peak limiter before
  writing the WAV.
- Do not delay power measurement or transmission detection while writing WAVs.
- Preserve the signal measurement if audio preparation or upload is
  permanently rejected.
- Clean up expired and orphaned cloud audio objects daily.

## Public Website

- Make the website public and read-only.
- Design mobile-first.
- Favor simplicity and legibility over dense controls or visual effects.
- Display the latest result prominently as a simple strength bar.
- Display every result from the last ten one-minute periods as a separate bar
  in the chart.
- Use bar height for peak dBFS and bar color for the relative score.
- Use a logarithmic duration scale for bar width:
  - One second uses the minimum width.
  - Thirty seconds or longer uses the maximum width.
  - Default to a 4 px minimum and an 18 px maximum.
- Store chart duration and width values in the website's public JSON
  configuration file.
- Poll for new data every five seconds.
- Update after the next poll following a completed transmission.
- Include a manual refresh control.
- Display stored UTC timestamps in the viewer's local timezone.
- Make each chart bar selectable.
- Show native browser audio controls when playback is available.
- State whether playback contains the complete transmission or only its
  opening excerpt.
- Provide no administrative or receiver-configuration functions.
- Ask standards-compliant crawlers not to index, follow, archive, or scrape
  the site using `robots.txt`, HTML metadata, and HTTP headers. Treat these as
  advisory signals rather than access control.

## Software and Deployment

- Use JavaScript unless a required hardware integration makes Python necessary.
- Prefer Node.js and npm on the Pi.
- Provide a reproducible installer.
- The installer may:
  - Install Debian packages
  - Install Node.js dependencies
  - Use `sudo`
  - Create and enable a `systemd` service
- Start the receiver service automatically after the Pi reboots.
- Store the production upload token outside the repository and receiver JSON
  configuration with root-only filesystem permissions.
- Send service output to the system journal and restart after process
  failures.

## Project

- Maintain Horn of Gondor as an independent sibling repository beside `radio-brain`.
- Publish the repository publicly on GitHub.
- License the project under the MIT License.

## MVP Exclusions

- Calibrated S-meter readings
- Unbounded or archival full-transmission audio recording
- Live audio streaming
- Voice transcription or content analysis
- Transmitter identification
- Equipment or antenna labels
- GPS tracking or receiver-location publishing
- Multiple receivers
- Web-based administration
- True server-push updates
