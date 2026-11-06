/** Independent microscopic driving models. Parameters use metres and seconds. */
export const VEHICLE_LENGTH = 3.8;
export type DriverProfile = {
  speedFactor: number;
  headway: number;
  minimumGap: number;
  acceleration: number;
  comfortableBrake: number;
  emergencyBrake: number;
  politeness: number;
  safeBrake: number;
};
export const DEFAULT_DRIVER: DriverProfile = {
  speedFactor: 1,
  headway: 1.25,
  minimumGap: 1.7,
  acceleration: 2.4,
  comfortableBrake: 2.5,
  emergencyBrake: 8,
  politeness: 0.25,
  safeBrake: 4,
};
export function driverProfile(id: number): DriverProfile {
  // Stable per-driver variation without consuming the demand generator's RNG.
  const f = (n: number) => {
    let x = Math.imul(id + n * 1013, 0x45d9f3b);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };
  return {
    speedFactor: 0.9 + f(1) * 0.1,
    headway: 1.05 + f(2) * 0.5,
    minimumGap: 1.4 + f(3) * 0.6,
    acceleration: 1.8 + f(4) * 0.9,
    comfortableBrake: 2.2 + f(5) * 0.7,
    emergencyBrake: 8,
    politeness: 0.15 + f(6) * 0.3,
    safeBrake: 4,
  };
}
export type Leader = { gap: number; speed: number };
export function followingAcceleration(
  speed: number,
  desiredSpeed: number,
  driver: DriverProfile = DEFAULT_DRIVER,
  leader?: Leader,
): number {
  const v = Math.max(0, speed),
    desired = Math.max(0.1, desiredSpeed);
  let value = driver.acceleration * (1 - (v / desired) ** 4);
  if (leader && Number.isFinite(leader.gap)) {
    const closing = v - Math.max(0, leader.speed);
    const dynamicGap =
      driver.minimumGap +
      Math.max(
        0,
        v * driver.headway +
          (v * closing) /
            (2 * Math.sqrt(driver.acceleration * driver.comfortableBrake)),
      );
    value -=
      driver.acceleration * (dynamicGap / Math.max(0.1, leader.gap)) ** 2;
  }
  return Math.max(-driver.emergencyBrake, Math.min(driver.acceleration, value));
}
export function advanceVehicle(
  speed: number,
  acceleration: number,
  dt: number,
) {
  const nextSpeed = Math.max(0, speed + acceleration * dt);
  const distance =
    acceleration < 0 && nextSpeed === 0
      ? (speed * speed) / Math.max(0.001, -2 * acceleration)
      : (speed + nextSpeed) * 0.5 * dt;
  return { speed: nextSpeed, distance: Math.max(0, distance) };
}
export function laneChangeIncentive(input: {
  before: number;
  after: number;
  followerBefore: number;
  followerAfter: number;
  oldFollowerBefore?: number;
  oldFollowerAfter?: number;
  driver: DriverProfile;
  bias?: number;
}) {
  if (input.followerAfter < -input.driver.safeBrake) return -Infinity;
  return (
    input.after -
    input.before +
    (input.bias ?? 0) +
    input.driver.politeness *
      (input.followerAfter -
        input.followerBefore +
        (input.oldFollowerAfter ?? 0) -
        (input.oldFollowerBefore ?? 0))
  );
}
