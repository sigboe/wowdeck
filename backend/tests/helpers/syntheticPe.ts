/** Minimal PE executables carrying icon resources, shaped like Windows builds. */

const RESOURCE_RVA = 0x1000;
export const RESOURCE_FILE_OFFSET = 0x200;
const OPTIONAL_SIZE = 0xe0;

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function put(bytes: Uint8Array, at: number, values: number[]): void {
  bytes.set(values, at);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

export type FixtureIcon = {
  id: number;
  width: number;
  height: number;
  payload: Uint8Array;
  /** The group entry's colour depth; 32 when unset. */
  bits?: number;
};

/**
 * A minimal PE32 with one `.rsrc` section: RT_GROUP_ICON(14) pointing at
 * RT_ICON(3) images. The same shape Windows builds, small enough to read.
 */
export function syntheticPe(icons: FixtureIcon[], pe32Plus = false): Uint8Array {
  const optionalSize = pe32Plus ? 0xf0 : OPTIONAL_SIZE;
  const dataBase = 0x58 + (pe32Plus ? 112 : 96);
  const iconNameDir = 32;
  const iconNameDirSize = 16 + icons.length * 8;
  const groupNameDir = iconNameDir + iconNameDirSize;
  const groupNameDirSize = 24;
  const langDirs = groupNameDir + groupNameDirSize;
  const langDirSize = 24;
  const groupLangDir = langDirs + icons.length * langDirSize;
  const dataEntries = groupLangDir + langDirSize;
  const dataEntriesSize = (icons.length + 1) * 16;
  const blobs = dataEntries + dataEntriesSize;

  const groupSize = 6 + icons.length * 14;
  const iconOffsets: number[] = [];
  let cursor = blobs + groupSize;
  for (const icon of icons) {
    iconOffsets.push(cursor);
    cursor = align4(cursor + icon.payload.length);
  }
  const resourceSize = cursor;

  const resource = new Uint8Array(resourceSize);
  // Type directory: RT_ICON then RT_GROUP_ICON.
  put(resource, 12, u16(0));
  put(resource, 14, u16(2));
  put(resource, 16, u32(3));
  put(resource, 20, u32(iconNameDir | 0x80000000));
  put(resource, 24, u32(14));
  put(resource, 28, u32(groupNameDir | 0x80000000));

  // Name directory for RT_ICON: one id per image.
  put(resource, iconNameDir + 14, u16(icons.length));
  icons.forEach((icon, index) => {
    put(resource, iconNameDir + 16 + index * 8, u32(icon.id));
    put(resource, iconNameDir + 20 + index * 8, u32((langDirs + index * langDirSize) | 0x80000000));
  });

  // Name directory for RT_GROUP_ICON: one group, id 1.
  put(resource, groupNameDir + 14, u16(1));
  put(resource, groupNameDir + 16, u32(1));
  put(resource, groupNameDir + 20, u32(groupLangDir | 0x80000000));

  const langEntry = (dir: number, dataEntry: number, language = 0x409) => {
    put(resource, dir + 14, u16(1));
    put(resource, dir + 16, u32(language));
    put(resource, dir + 20, u32(dataEntry));
  };
  icons.forEach((_icon, index) =>
    langEntry(langDirs + index * langDirSize, dataEntries + index * 16),
  );
  langEntry(groupLangDir, dataEntries + icons.length * 16);

  const dataEntry = (index: number, rva: number, size: number) => {
    put(resource, dataEntries + index * 16, u32(rva));
    put(resource, dataEntries + index * 16 + 4, u32(size));
    put(resource, dataEntries + index * 16 + 8, u32(0));
    put(resource, dataEntries + index * 16 + 12, u32(0));
  };
  icons.forEach((icon, index) =>
    dataEntry(index, RESOURCE_RVA + iconOffsets[index], icon.payload.length),
  );
  dataEntry(icons.length, RESOURCE_RVA + blobs, groupSize);

  // The group: GRPICONDIR + one GRPICONDIRENTRY per image.
  put(resource, blobs, [0, 0, 1, 0, ...u16(icons.length)]);
  icons.forEach((icon, index) => {
    const at = blobs + 6 + index * 14;
    put(resource, at, [
      icon.width,
      icon.height,
      0,
      0,
      ...u16(1),
      ...u16(icon.bits ?? 32),
      ...u32(icon.payload.length),
      ...u16(icon.id),
    ]);
  });
  icons.forEach((icon, index) => resource.set(icon.payload, iconOffsets[index]));

  const sectionSize = align4(resourceSize);
  const bytes = new Uint8Array(RESOURCE_FILE_OFFSET + sectionSize);
  put(bytes, 0, [0x4d, 0x5a]);
  put(bytes, 0x3c, u32(0x40));
  put(bytes, 0x40, [0x50, 0x45, 0, 0]);
  put(bytes, 0x44, u16(0x14c));
  put(bytes, 0x46, u16(1));
  put(bytes, 0x54, u16(optionalSize));
  put(bytes, 0x58, u16(pe32Plus ? 0x20b : 0x10b));
  put(bytes, dataBase - 4, u32(16));
  put(bytes, dataBase + 2 * 8, u32(RESOURCE_RVA));
  put(bytes, dataBase + 2 * 8 + 4, u32(resourceSize));
  const section = 0x40 + 24 + optionalSize;
  put(
    bytes,
    section,
    [...".rsrc"].map((c) => c.charCodeAt(0)),
  );
  put(bytes, section + 8, u32(resourceSize));
  put(bytes, section + 12, u32(RESOURCE_RVA));
  put(bytes, section + 16, u32(sectionSize));
  put(bytes, section + 20, u32(RESOURCE_FILE_OFFSET));
  bytes.set(resource, RESOURCE_FILE_OFFSET);
  return bytes;
}

// A 1x1 BGRA bitmap with its AND mask. The DIB height counts both rows.
export const BMP = Uint8Array.from([
  ...u32(40),
  ...u32(1),
  ...u32(2),
  ...u16(1),
  ...u16(32),
  ...new Uint8Array(24),
  0,
  0,
  255,
  255,
  0,
  0,
  0,
  0,
]);
export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2sAAAAASUVORK5CYII=",
    "base64",
  ),
);
