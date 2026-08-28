// Ngày lễ Việt Nam — dùng để AI suy ra NGÀY DƯƠNG cụ thể khi người dùng nhắc TÊN lễ
// (vd "Quốc khánh", "Tết Nguyên đán", "Giỗ Tổ Hùng Vương") thay vì tự bịa ngày.
//
// Thuật toán chuyển Dương -> Âm và danh sách lễ được PORT nguyên trạng từ
// calender246/src/app/lunar/lunar.util.ts và calender246/src/app/calendar/holidays.service.ts
// (thuật toán thiên văn Hồ Ngọc Đức / Jean Meeus) để AI và giao diện lịch cho ra CÙNG một
// kết quả ngày lễ, tránh 2 nguồn tính lệch nhau.

const PI = Math.PI;
const VN_TIMEZONE = 7;

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = Math.floor((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd =
    dd +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  if (jd < 2299161) {
    jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  }
  return jd;
}

function getNewMoonDay(k: number, timeZone: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat: number;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  const JdNew = Jd1 + C1 - deltat;
  return Math.floor(JdNew + 0.5 + timeZone / 24);
}

function getSunLongitude(jdn: number, timeZone: number): number {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = L0 + DL;
  L = L * dr;
  L = L - PI * 2 * Math.floor(L / (PI * 2));
  return Math.floor((L / PI) * 6);
}

function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

interface LunarDate {
  day: number;
  month: number;
  year: number;
  leap: boolean;
}

function solarToLunar(dd: number, mm: number, yy: number, timeZone: number = VN_TIMEZONE): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = true;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth = lunarMonth - 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

/** Ngày lễ có ngày/tháng CỐ ĐỊNH theo Dương lịch. */
const FIXED_SOLAR: { month: number; day: number; name: string; isPublic: boolean }[] = [
  { month: 1, day: 1, name: 'Tết Dương lịch', isPublic: true },
  { month: 2, day: 14, name: 'Valentine', isPublic: false },
  { month: 3, day: 8, name: 'Quốc tế Phụ nữ', isPublic: false },
  { month: 4, day: 30, name: 'Ngày Giải phóng miền Nam', isPublic: true },
  { month: 5, day: 1, name: 'Quốc tế Lao động', isPublic: true },
  { month: 6, day: 1, name: 'Quốc tế Thiếu nhi', isPublic: false },
  { month: 9, day: 2, name: 'Quốc khánh', isPublic: true },
  { month: 10, day: 20, name: 'Ngày Phụ nữ Việt Nam', isPublic: false },
  { month: 11, day: 20, name: 'Ngày Nhà giáo Việt Nam', isPublic: false },
  { month: 12, day: 22, name: 'Ngày Quân đội Nhân dân', isPublic: false },
  { month: 12, day: 24, name: 'Đêm Giáng sinh', isPublic: false },
  { month: 12, day: 25, name: 'Giáng sinh', isPublic: false },
];

/** Ngày lễ theo lịch ÂM — xác định bằng NGÀY/THÁNG âm lịch (đúng cho mọi năm). */
const LUNAR_HOLIDAYS: { day: number; month: number; name: string; isPublic: boolean }[] = [
  { day: 1, month: 1, name: 'Tết Nguyên đán', isPublic: true },
  { day: 2, month: 1, name: 'Mùng 2 Tết', isPublic: true },
  { day: 3, month: 1, name: 'Mùng 3 Tết', isPublic: true },
  { day: 15, month: 1, name: 'Tết Nguyên tiêu (Rằm tháng Giêng)', isPublic: false },
  { day: 10, month: 3, name: 'Giỗ Tổ Hùng Vương', isPublic: true },
  { day: 15, month: 4, name: 'Lễ Phật Đản', isPublic: false },
  { day: 5, month: 5, name: 'Tết Đoan Ngọ', isPublic: false },
  { day: 15, month: 7, name: 'Lễ Vu Lan', isPublic: false },
  { day: 15, month: 8, name: 'Tết Trung thu', isPublic: false },
  { day: 23, month: 12, name: 'Ông Công Ông Táo', isPublic: false },
];

export interface HolidayEntry {
  /** Ngày dương lịch ISO (YYYY-MM-DD). */
  date: string;
  name: string;
  isPublic: boolean;
}

const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

/** Tính TOÀN BỘ ngày lễ (dương + âm) rơi vào 1 năm dương lịch cho trước. Kết quả cache theo năm vì không đổi. */
const yearCache = new Map<number, HolidayEntry[]>();

export function getVietnamHolidays(year: number): HolidayEntry[] {
  const cached = yearCache.get(year);
  if (cached) return cached;

  const result: HolidayEntry[] = [];
  for (let mm = 1; mm <= 12; mm++) {
    const dim = daysInMonth(year, mm);
    for (let dd = 1; dd <= dim; dd++) {
      let holiday: { name: string; isPublic: boolean } | null = null;
      const lunar = solarToLunar(dd, mm, year);
      if (!lunar.leap) {
        const h = LUNAR_HOLIDAYS.find((x) => x.day === lunar.day && x.month === lunar.month);
        if (h) holiday = { name: h.name, isPublic: h.isPublic };
      }
      if (!holiday) {
        const found = FIXED_SOLAR.find((h) => h.month === mm && h.day === dd);
        if (found) holiday = { name: found.name, isPublic: found.isPublic };
      }
      if (holiday) {
        result.push({
          date: `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
          name: holiday.name,
          isPublic: holiday.isPublic,
        });
      }
    }
  }
  yearCache.set(year, result);
  return result;
}
