/**
 * Timestamp value type with the same surface as Firestore's `Timestamp`, so
 * existing code calling `toDate()`, `seconds`, `toMillis()` etc. keeps working.
 * Shared by the browser and the server.
 */
export default class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = Math.floor(seconds);
    this.nanoseconds = Math.floor(nanoseconds);
  }

  static fromMillis(ms) {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }

  static fromDate(date) {
    return Timestamp.fromMillis(new Date(date).getTime());
  }

  static now() {
    return Timestamp.fromMillis(Date.now());
  }

  static fromISOString(iso) {
    return Timestamp.fromMillis(Date.parse(iso));
  }

  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }

  toDate() {
    return new Date(this.toMillis());
  }

  toISOString() {
    return this.toDate().toISOString();
  }

  isEqual(other) {
    return (
      other instanceof Timestamp &&
      other.seconds === this.seconds &&
      other.nanoseconds === this.nanoseconds
    );
  }

  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }

  toString() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }

  /**
   * Like Firestore, return a string that sorts in time order so that `<` and
   * `>` comparisons between timestamps work.
   */
  valueOf() {
    const adjusted = this.seconds - -62135596800; // seconds since year 1
    return `${String(adjusted).padStart(12, '0')}.${String(this.nanoseconds).padStart(
      9,
      '0'
    )}`;
  }
}
