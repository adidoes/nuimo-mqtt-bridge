import { config } from "dotenv";
config();

import mqtt, { MqttClient } from "mqtt";
import {
  DeviceDiscoveryManager,
  NuimoControlDevice,
  Glyph,
  TouchGestureArea,
} from "rocket-nuimo";

const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost";
const MQTT_USERNAME = process.env.MQTT_USERNAME || "my_user";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "my_password";
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "nuimo";
const HA_DISCOVERY_PREFIX = "homeassistant";

const devices: Map<string, NuimoControlDevice> = new Map();

function publishDeviceDetails(client: MqttClient, device: NuimoControlDevice) {
  const deviceDetails = {
    id: device.id,
    batteryLevel: device.batteryLevel,
    rssi: device.rssi,
    isConnected: device.isConnected,
    brightness: device.brightness,
  };

  client.publish(
    `${MQTT_TOPIC_PREFIX}/${device.id}/details`,
    JSON.stringify(deviceDetails)
  );
  console.log("Published device details:", deviceDetails);
}

function publishHomeAssistantDiscovery(
  client: MqttClient,
  device: NuimoControlDevice
) {
  const deviceInfo = {
    identifiers: [device.id],
    name: `Nuimo Control ${device.id}`,
    model: "Nuimo Control",
    manufacturer: "Senic",
  };

  const configs = [
    // Existing sensors
    {
      type: "sensor",
      component: "battery",
      config: {
        device_class: "battery",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/battery`,
        unit_of_measurement: "%",
        value_template: "{{ value_json.level }}",
      },
    },
    {
      type: "sensor",
      component: "rssi",
      config: {
        device_class: "signal_strength",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/rssi`,
        unit_of_measurement: "dBm",
        value_template: "{{ value_json.rssi }}",
      },
    },
    {
      type: "binary_sensor",
      component: "connection",
      config: {
        device_class: "connectivity",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/details`,
        value_template: "{{ value_json.isConnected }}",
        payload_on: "true",
        payload_off: "false",
      },
    },
    {
      type: "sensor",
      component: "rotation",
      config: {
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/rotate`,
        value_template: "{{ value_json.delta }}",
      },
    },
    // New components
    {
      type: "button",
      component: "select",
      config: {
        command_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/button/select`,
        payload_press: "PRESS",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/button`,
        value_template: "{{ value_json.state }}",
      },
    },
    {
      type: "binary_sensor",
      component: "hover",
      config: {
        device_class: "motion",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/hover`,
        value_template: "{{ float(value_json.proximity) > 0 }}",
        payload_on: "true",
        payload_off: "false",
      },
    },
    {
      type: "sensor",
      component: "hover_proximity",
      config: {
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/hover`,
        value_template: "{{ value_json.proximity }}",
        unit_of_measurement: "",
      },
    },
    {
      type: "sensor",
      component: "last_swipe",
      config: {
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/+`,
        value_template: `
          {% if topic.endswith('swipeLeft') %}
            Left
          {% elif topic.endswith('swipeRight') %}
            Right
          {% elif topic.endswith('swipeUp') %}
            Up
          {% elif topic.endswith('swipeDown') %}
            Down
          {% else %}
            Unknown
          {% endif %}
        `,
      },
    },
    {
      type: "binary_sensor",
      component: "touch",
      config: {
        device_class: "occupancy",
        state_topic: `${MQTT_TOPIC_PREFIX}/${device.id}/+`,
        value_template: `
          {% if 'touch' in topic %}
            ON
          {% else %}
            OFF
          {% endif %}
        `,
        payload_on: "ON",
        payload_off: "OFF",
      },
    },
  ];

  configs.forEach(({ type, component, config }) => {
    const topic = `${HA_DISCOVERY_PREFIX}/${type}/${device.id}/${component}/config`;
    const message = JSON.stringify({
      ...config,
      name: `${deviceInfo.name} ${component}`,
      unique_id: `nuimo_${device.id}_${component}`,
      device: deviceInfo,
    });

    client.publish(topic, message, { retain: true });
    console.log(`Published Home Assistant discovery for ${component}:`, topic);
  });
}

function initializeNuimo(mqttClient: MqttClient) {
  const manager = DeviceDiscoveryManager.defaultManager;
  const session = manager.startDiscoverySession();
  console.log("Waiting for Nuimo devices...");

  session.on("device", async (device: NuimoControlDevice) => {
    console.log(`Found Nuimo device: ${device.id}`);
    await device.connect();
    await device.setRotationRange(0, 10);
    console.log(`Connected to Nuimo device: ${device.id}`);
    devices.set(device.id, device);
    publishDeviceDetails(mqttClient, device);
    publishHomeAssistantDiscovery(mqttClient, device);
    setupMQTTListeners(mqttClient, device);
    setupNuimoListeners(mqttClient, device);
    handleDisconnect(mqttClient, device);
  });
}

function setupMQTTListeners(client: MqttClient, device: NuimoControlDevice) {
  client.subscribe(`${MQTT_TOPIC_PREFIX}/${device.id}/display`);
  client.subscribe(`${MQTT_TOPIC_PREFIX}/${device.id}/brightness`);

  client.on("message", (topic, message) => {
    const [prefix, deviceId, command] = topic.split("/");
    if (deviceId !== device.id) return;

    const payload = message.toString();

    if (command === "display") {
      try {
        const glyphData = JSON.parse(payload);
        console.log("glyphData.rows", glyphData.rows);
        const glyph = Glyph.fromString(glyphData.rows);
        device.displayGlyph(glyph, { brightness: glyphData.brightness });
      } catch (err) {
        console.error("Error displaying glyph:", err);
      }
    } else if (command === "brightness") {
      const brightness = parseFloat(payload);
      if (!isNaN(brightness) && brightness >= 0 && brightness <= 1) {
        device.brightness = brightness;
      } else {
        console.error("Invalid brightness value:", payload);
      }
    }
  });
}

function setupNuimoListeners(client: MqttClient, device: NuimoControlDevice) {
  const logAndPublishEvent = (event: string, payload: any = {}) => {
    console.log(`Event: ${event}`, payload);
    client.publish(
      `${MQTT_TOPIC_PREFIX}/${device.id}/${event}`,
      JSON.stringify(payload)
    );
  };

  // Touch events
  // device.on("touch", (area: TouchGestureArea) => {
  //   logAndPublishEvent("touch", { area });
  // });
  device.on("touchBottom", () => logAndPublishEvent("touchBottom"));
  device.on("touchLeft", () => logAndPublishEvent("touchLeft"));
  device.on("touchRight", () => logAndPublishEvent("touchRight"));
  device.on("touchTop", () => logAndPublishEvent("touchTop"));

  // Long touch events
  // device.on("longTouch", (area: TouchGestureArea) => {
  //   logAndPublishEvent("longTouch", { area });
  // });
  device.on("longTouchBottom", () => logAndPublishEvent("longTouchBottom"));
  device.on("longTouchLeft", () => logAndPublishEvent("longTouchLeft"));
  device.on("longTouchRight", () => logAndPublishEvent("longTouchRight"));

  // Swipe events
  // device.on("swipe", (area: TouchGestureArea, hoverSwipe: boolean) => {
  //   logAndPublishEvent("swipe", { area, hoverSwipe });
  // });
  device.on("swipeDown", () => logAndPublishEvent("swipeDown"));
  device.on("swipeUp", () => logAndPublishEvent("swipeUp"));
  device.on("swipeLeft", (hoverSwipe: boolean) =>
    logAndPublishEvent("swipeLeft", { hoverSwipe })
  );
  device.on("swipeRight", (hoverSwipe: boolean) =>
    logAndPublishEvent("swipeRight", { hoverSwipe })
  );

  // Existing events
  device.on("select", () => logAndPublishEvent("select"));
  device.on("selectDown", () =>
    logAndPublishEvent("button", { state: "pressed" })
  );
  device.on("selectUp", () =>
    logAndPublishEvent("button", { state: "released" })
  );
  device.on("rotate", (delta: number) =>
    logAndPublishEvent("rotate", { delta })
  );
  device.on("batteryLevel", (level: number) => {
    logAndPublishEvent("battery", { level });
    publishDeviceDetails(client, device);
  });
  device.on("rssi", (rssi: number) => {
    logAndPublishEvent("rssi", { rssi });
    publishDeviceDetails(client, device);
  });

  // Hover event
  device.on("hover", (proximity) => {
    logAndPublishEvent("hover", { proximity: proximity.toFixed(4) });
  });
}

function handleDisconnect(mqttClient: MqttClient, device: NuimoControlDevice) {
  device.on("disconnect", () => {
    console.log(
      `Nuimo device disconnected: ${device.id}. Attempting to reconnect...`
    );
    reconnectDevice(mqttClient, device);
  });
}

async function reconnectDevice(
  mqttClient: MqttClient,
  device: NuimoControlDevice
) {
  try {
    await device.connect();
    await device.setRotationRange(0, 10);
    console.log(`Reconnected to Nuimo device: ${device.id}`);
    publishDeviceDetails(mqttClient, device);
    publishHomeAssistantDiscovery(mqttClient, device);
    setupNuimoListeners(mqttClient, device);
  } catch (err) {
    console.error(`Failed to reconnect to Nuimo device ${device.id}:`, err);
    setTimeout(() => reconnectDevice(mqttClient, device), 5000);
  }
}

async function main() {
  try {
    const mqttClient = await mqtt.connectAsync(MQTT_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
    });

    console.log("Connected to MQTT broker");

    initializeNuimo(mqttClient);

    console.log("Nuimo MQTT bridge is running");

    mqttClient.on("close", () => {
      console.log("MQTT connection closed. Exiting...");
      process.exit(1);
    });
  } catch (err) {
    console.error("Error initializing the application:", err);
    process.exit(1);
  }
}

main();
