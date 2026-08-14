/**
 * The farm's real geometry, as migration 046 left it.
 *
 * Read back out of the database rather than retyped, so the map and acreage
 * tests exercise the shape that is actually on file — five units that sum to
 * the perimeter with nothing left over.
 *
 * 046 moved the P4/P5 fence off a drawn straight line and onto the ground,
 * which is why Paddock 4 is shorter than its 044 figure: the hundred feet it
 * lost were a ten-foot ribbon under its neighbour, not paddock.
 */

export const REAL_BOUNDARIES: Record<string, unknown> = {
  "Paddock 1": {"type": "Polygon", "coordinates": [[[-88.41291314, 42.87833348], [-88.41299683, 42.87876087], [-88.41331173, 42.87882226], [-88.41412428, 42.87883078], [-88.41463922, 42.87873318], [-88.41489766, 42.87874084], [-88.41491083, 42.87833348], [-88.41291314, 42.87833348]]]},
  "Paddock 2": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87778163], [-88.41335974, 42.87833348], [-88.41491083, 42.87833348], [-88.41492868, 42.87778163], [-88.41335974, 42.87778163]]]},
  "Paddock 3": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41335974, 42.87778163], [-88.41492868, 42.87778163], [-88.41494669, 42.87722457], [-88.41335974, 42.87722457]]]},
  "Paddock 4": {"type": "Polygon", "coordinates": [[[-88.41415662, 42.87671229], [-88.413731, 42.87662757], [-88.41317476, 42.8765312], [-88.41306449, 42.87688276], [-88.41307961, 42.87719421], [-88.41335974, 42.87722457], [-88.41494669, 42.87722457], [-88.41495831, 42.87686518], [-88.41415662, 42.87671229]]]},
  "Paddock 5": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41307961, 42.87719421], [-88.41269056, 42.87719684], [-88.41291314, 42.87833348], [-88.41335974, 42.87833348], [-88.41335974, 42.87722457]]]},
};

export const REAL_ACRES: Record<string, number> = {
  "Paddock 1": 2.021,
  "Paddock 2": 1.932,
  "Paddock 3": 1.972,
  "Paddock 4": 2.227,
  "Paddock 5": 1.416,
};

export const REAL_SWEEP: Record<string, { headingDeg: number; lengthFt: number }> = {
  "Paddock 1": { headingDeg: 270, lengthFt: 535 },
  "Paddock 2": { headingDeg: 90, lengthFt: 420 },
  "Paddock 3": { headingDeg: 270, lengthFt: 425 },
  "Paddock 4": { headingDeg: 90, lengthFt: 507 },
  "Paddock 5": { headingDeg: 0, lengthFt: 416 },
};

export const REAL_FENCES: { name: string; status: string; geometry: unknown }[] = [
  { name: "North interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41491222582417, 42.87833347549089], [-88.41335973701894, 42.87833698670671], [-88.41291959469925, 42.87833683169362]]} },
  { name: "East interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41335973701894, 42.87833698670671], [-88.41335435366699, 42.87722456820611]]} },
  { name: "South interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41494048993077, 42.87721959822932], [-88.41335435366699, 42.87722456820611], [-88.41308246334731, 42.87719613690506]]} },
  { name: "Middle interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41491749833345, 42.87778162512814], [-88.41335912145296, 42.87778118081621]]} },
  { name: "Perimeter fence", status: "existing", geometry: {"type": "LineString", "coordinates": [[-88.41415661611339, 42.87671228695303], [-88.41373100023101, 42.87662756783331], [-88.41317476329905, 42.87653120431429], [-88.41306449314374, 42.87688276322167], [-88.4130796058033, 42.87719421074982], [-88.41269055798223, 42.8771968409059], [-88.41299683267957, 42.87876086983165], [-88.41331172623335, 42.87882225600689], [-88.4141242802737, 42.87883078164459], [-88.41463921817487, 42.87873318343745], [-88.41489765718502, 42.87874083885301], [-88.41495831448356, 42.87686517881129], [-88.41415661611339, 42.87671228695303]]} },
];
