---
id: homebridge
name: Homebridge Control
version: 1.0.0
description: Control HomeKit devices through Homebridge API
author: Atlas Team
repository: https://github.com/atlas-desktop/skills-homebridge
tags: smarthome, homekit, iot, automation
---

# Homebridge Control Skill

Control your smart home devices through Homebridge's API. This skill enables
Atlas to interact with any HomeKit-compatible device connected to your
Homebridge instance.

## Gating

- binary: homebridge - Homebridge must be installed
- env: HOMEBRIDGE_PIN - Your Homebridge PIN for authentication
- env: HOMEBRIDGE_HOST - Homebridge API host (default: localhost)
- config: homebridge.port - Homebridge API port (default: 8581)

## Tools

### homebridge_devices

List all devices registered with Homebridge.

Returns information about each device including:
- Device name and type
- Current state
- Available services
- Room/zone assignment

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Filter by room name (optional)"
    },
    "type": {
      "type": "string",
      "description": "Filter by device type (optional)"
    }
  },
  "required": []
}
```

**Example:**
```
List all devices: homebridge_devices
List living room devices: homebridge_devices room="Living Room"
List all lights: homebridge_devices type="lightbulb"
```

### homebridge_control

Control a Homebridge device.

Set the state of a device - turn on/off, adjust brightness,
change temperature, etc.

```json
{
  "type": "object",
  "properties": {
    "device": {
      "type": "string",
      "description": "Device name or unique ID"
    },
    "action": {
      "type": "string",
      "enum": ["on", "off", "toggle", "set"],
      "description": "Action to perform"
    },
    "value": {
      "type": ["number", "string", "boolean"],
      "description": "Value to set (for 'set' action)"
    },
    "characteristic": {
      "type": "string",
      "description": "Which characteristic to control (brightness, temperature, etc.)"
    }
  },
  "required": ["device", "action"]
}
```

**Examples:**
```
Turn on the bedroom light: homebridge_control device="Bedroom Light" action="on"
Set brightness to 50%: homebridge_control device="Bedroom Light" action="set" value=50 characteristic="brightness"
Toggle the kitchen: homebridge_control device="Kitchen Lights" action="toggle"
```

### homebridge_scene

Activate a Homebridge/HomeKit scene.

```json
{
  "type": "object",
  "properties": {
    "scene": {
      "type": "string",
      "description": "Scene name to activate"
    }
  },
  "required": ["scene"]
}
```

### homebridge_status

Get the status of a specific device.

```json
{
  "type": "object",
  "properties": {
    "device": {
      "type": "string",
      "description": "Device name or unique ID"
    }
  },
  "required": ["device"]
}
```

## Prompts

### smart_home_context

When the user asks about their smart home, lights, or home automation,
include relevant device context and suggest helpful actions.

Common phrases to recognize:
- "turn on/off the [device]"
- "dim the lights"
- "what devices are on"
- "is the [device] on/off"
- "set [device] to [value]"

Provide helpful suggestions like:
- "I notice your living room lights are on. Would you like me to turn them off?"
- "The bedroom is set to 30% brightness. Would you like to adjust it?"

## Documentation

### Setup

1. Install Homebridge: `npm install -g homebridge`
2. Configure your devices in Homebridge
3. Set environment variables:
   - `HOMEBRIDGE_PIN`: Your 8-digit PIN (format: XXX-XX-XXX)
   - `HOMEBRIDGE_HOST`: API host (default: localhost)
4. Enable this skill in Atlas settings

### Supported Device Types

- **Lights**: On/off, brightness, color temperature, RGB color
- **Switches**: On/off
- **Thermostats**: Temperature, mode (heat/cool/auto/off)
- **Sensors**: Read-only (temperature, humidity, motion, contact)
- **Blinds/Shades**: Position (0-100%)
- **Locks**: Lock/unlock
- **Fans**: On/off, speed
- **Outlets**: On/off

### Troubleshooting

**"Cannot connect to Homebridge"**
- Ensure Homebridge is running
- Check that the host and port are correct
- Verify your PIN is correct

**"Device not found"**
- Use `homebridge_devices` to list available devices
- Check the exact device name (case-sensitive)
- The device may be offline

### Security Notes

- The Homebridge PIN is stored securely in your OS keychain
- All API calls are made locally (no cloud required)
- Atlas will confirm before performing destructive actions
