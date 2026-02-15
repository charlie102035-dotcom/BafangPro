const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertFiniteNumber = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
};

const assertSensorStatus = (sensor, index) => {
  if (!isObject(sensor)) {
    throw new TypeError(`sensors[${index}] must be an object`);
  }
  if (typeof sensor.id !== 'string' || !sensor.id) {
    throw new TypeError(`sensors[${index}].id must be a non-empty string`);
  }
  if (typeof sensor.label !== 'string' || !sensor.label) {
    throw new TypeError(`sensors[${index}].label must be a non-empty string`);
  }
  assertFiniteNumber(sensor.temperatureC, `sensors[${index}].temperatureC`);
  assertFiniteNumber(sensor.targetTemperatureC, `sensors[${index}].targetTemperatureC`);
  assertFiniteNumber(sensor.oilLevelPct, `sensors[${index}].oilLevelPct`);
  if (typeof sensor.heaterOn !== 'boolean') {
    throw new TypeError(`sensors[${index}].heaterOn must be a boolean`);
  }
  if (sensor.alarm !== null && typeof sensor.alarm !== 'string') {
    throw new TypeError(`sensors[${index}].alarm must be a string or null`);
  }
  assertFiniteNumber(sensor.updatedAt, `sensors[${index}].updatedAt`);
};

export const assertSensorProvider = (provider) => {
  if (!provider || typeof provider.getStatusSnapshot !== 'function') {
    throw new TypeError(
      'Sensor provider must implement async getStatusSnapshot()',
    );
  }
};

export const assertSensorStatusSnapshot = (snapshot) => {
  if (!isObject(snapshot)) {
    throw new TypeError('Sensor snapshot must be an object');
  }
  if (typeof snapshot.provider !== 'string' || !snapshot.provider) {
    throw new TypeError('snapshot.provider must be a non-empty string');
  }
  assertFiniteNumber(snapshot.updatedAt, 'snapshot.updatedAt');
  if (!Array.isArray(snapshot.sensors)) {
    throw new TypeError('snapshot.sensors must be an array');
  }
  snapshot.sensors.forEach(assertSensorStatus);
  return snapshot;
};
