# Nuimo MQTT Bridge

This project creates an MQTT bridge for the Nuimo bluetooth remote control using the rocket-nuimo library.

## Environment Variables

- `MQTT_URL`: MQTT broker URL (default: `mqtt://localhost`)
- `MQTT_USERNAME`: MQTT username (default: `my_user`)
- `MQTT_PASSWORD`: MQTT password (default: `my_password`)
- `MQTT_TOPIC_PREFIX`: MQTT topic prefix (default: `nuimo`)

## Docker Compose Example

```yaml
version: "3"
services:
  nuimo-mqtt-bridge:
    image: ghcr.io/yourusername/nuimo-mqtt-bridge:main
    environment:
      - MQTT_URL=mqtt://your-mqtt-broker
      - MQTT_USERNAME=your_username
      - MQTT_PASSWORD=your_password
      - MQTT_TOPIC_PREFIX=nuimo
    restart: unless-stopped
    privileged: true
    network_mode: host
```
