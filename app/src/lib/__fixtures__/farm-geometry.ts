/**
 * The farm's real geometry, as migration 040 loaded it.
 *
 * Copied from the KML rather than invented, so the map tests exercise the
 * shape that is actually on file — five units that sum to the perimeter with
 * nothing left over.
 */

export const REAL_BOUNDARIES: Record<string, unknown> = {
  "Paddock 1": {"type": "Polygon", "coordinates": [[[-88.41291848, 42.87833348], [-88.41300389, 42.87875941], [-88.4133151, 42.87882266], [-88.41412207, 42.8788266], [-88.41463991, 42.87873066], [-88.41489732, 42.87873426], [-88.41490975, 42.87833348], [-88.41291848, 42.87833348]]]},
  "Paddock 2": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87778163], [-88.41335974, 42.87833348], [-88.41490975, 42.87833348], [-88.41492686, 42.87778163], [-88.41335974, 42.87778163]]]},
  "Paddock 3": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41335974, 42.87778163], [-88.41492686, 42.87778163], [-88.41494413, 42.87722457], [-88.41335974, 42.87722457]]]},
  "Paddock 4": {"type": "Polygon", "coordinates": [[[-88.41415662, 42.87671229], [-88.413731, 42.87662757], [-88.41317631, 42.87653264], [-88.41306449, 42.87688276], [-88.41308139, 42.87719553], [-88.41269056, 42.87719684], [-88.41269612, 42.87722457], [-88.41494413, 42.87722457], [-88.41495524, 42.87686621], [-88.41415662, 42.87671229]]]},
  "Paddock 5": {"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41269612, 42.87722457], [-88.41291848, 42.87833348], [-88.41335974, 42.87833348], [-88.41335974, 42.87722457]]]},
};

export const REAL_ACRES: Record<string, number> = {
  "Paddock 1": 2.003,
  "Paddock 2": 1.93,
  "Paddock 3": 1.97,
  "Paddock 4": 2.255,
  "Paddock 5": 1.375,
};

export const REAL_SWEEP: Record<string, { headingDeg: number; lengthFt: number }> = {
  "Paddock 1": { headingDeg: 270, lengthFt: 533 },
  "Paddock 2": { headingDeg: 90, lengthFt: 419 },
  "Paddock 3": { headingDeg: 270, lengthFt: 424 },
  "Paddock 4": { headingDeg: 90, lengthFt: 606 },
  "Paddock 5": { headingDeg: 0, lengthFt: 405 },
};

export const REAL_FENCES: { name: string; status: string; geometry: unknown }[] = [
  { name: "North interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41491222582417, 42.87833347549089], [-88.41335973701894, 42.87833698670671], [-88.41291959469925, 42.87833683169362]]} },
  { name: "East interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41335973701894, 42.87833698670671], [-88.41335435366699, 42.87722456820611]]} },
  { name: "South interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41494048993077, 42.87721959822932], [-88.41335435366699, 42.87722456820611], [-88.41308246334731, 42.87719613690506]]} },
  { name: "Middle interior fence", status: "planned", geometry: {"type": "LineString", "coordinates": [[-88.41491749833345, 42.87778162512814], [-88.41335912145296, 42.87778118081621]]} },
  { name: "Perimeter fence", status: "existing", geometry: {"type": "LineString", "coordinates": [[-88.41415661611339, 42.87671228695303], [-88.41373100023101, 42.87662756783331], [-88.41317630694518, 42.87653263511906], [-88.41306449314374, 42.87688276322167], [-88.41308139459608, 42.87719553123256], [-88.41269055798223, 42.8771968409059], [-88.41300388551464, 42.87875940971139], [-88.4133151042539, 42.87882266474044], [-88.41412207320528, 42.87882659680924], [-88.41463991098591, 42.87873065610868], [-88.41489732299772, 42.8787342624153], [-88.41495524099521, 42.87686621095465], [-88.41415661611339, 42.87671228695303]]} },
];
