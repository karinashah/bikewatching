mapboxgl.accessToken =
  "pk.eyJ1IjoiazdzaGFoIiwiYSI6ImNtYXJoZnl6czA3NWoycm9ka2wwNWtub2sifQ.3oGtFSudDScGB12z9w_ypw";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.11822196963853, 42.37465074382746],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select("#map").append("svg");
let stations = [];
let timeFilter = -1;
let trips = [];
let radiusScale, circles;
let filteredStations = [];
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function updateCircles() {
  circles
    .attr("r", (d) => radiusScale(d.totalTraffic) || 0)
    .attr("opacity", (d) => (d.totalTraffic > 0 ? 0.6 : 0))
    .style("--departure-ratio", (d) =>
      stationFlow(d.departures / d.totalTraffic || 0)
    )
    .select("title")
    .text(
      (d) =>
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
    );
}

const timeSlider = document.getElementById("time-slider");
timeSlider.addEventListener("input", () => {
  updateTimeDisplay();
  if (trips.length > 0 && stations.length > 0) {
    filterTripsbyTime();
    map.resize();
    updateCircles();
  }
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");
  if (timeFilter === -1) {
    selectedTime.textContent = "";
    anyTimeLabel.style.display = "block";
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = "none";
  }
}

function minutesSinceMidnight(date) {
  if (!(date instanceof Date) || isNaN(date)) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function filterTripsbyTime() {
  let filteredDeparturesTrips, filteredArrivalsTrips;
  if (timeFilter === -1) {
    filteredDeparturesTrips = trips;
    filteredArrivalsTrips = trips;
  } else {
    filteredDeparturesTrips = filterByMinute(departuresByMinute, timeFilter);
    filteredArrivalsTrips = filterByMinute(arrivalsByMinute, timeFilter);
  }

  filteredArrivals = d3.rollup(
    filteredArrivalsTrips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  filteredDepartures = d3.rollup(
    filteredDeparturesTrips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  stations.forEach((station) => {
    const id = station.short_name;
    station.arrivals = filteredArrivals.get(id) ?? 0;
    station.departures = filteredDepartures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
  });

  radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range(timeFilter === -1 ? [0, 25] : [0, 25]);
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

map.on("load", () => {
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...",
  });
  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson?...",
  });

  map.addLayer({
    id: "bike-lanes-boston",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "#32CD32",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  map.addLayer({
    id: "bike-lanes-cambridge",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "#32CD32",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

  d3.json(jsonurl)
    .then((jsonData) => {
      stations = jsonData.data.stations;
      map.resize();

      return d3
        .csv("https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv")
        .then((loadedTrips) => {
          trips = loadedTrips;

          for (let trip of trips) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            let startedMinutes = minutesSinceMidnight(trip.started_at);
            let endedMinutes = minutesSinceMidnight(trip.ended_at);
            departuresByMinute[startedMinutes].push(trip);
            arrivalsByMinute[endedMinutes].push(trip);
          }

          const departures = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.start_station_id
          );

          const arrivals = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.end_station_id
          );

          stations.forEach((station) => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
          });

          filteredStations = stations;

          radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

          circles = svg
            .selectAll("circle")
            .data(stations, (d) => d.short_name)
            .enter()
            .append("circle")
            .attr("r", (d) => radiusScale(d.totalTraffic))
            .style("--departure-ratio", (d) =>
              stationFlow(d.departures / d.totalTraffic || 0)
            )
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .attr("opacity", 0.6)
            .style("pointer-events", "auto")
            .each(function (d) {
              d3.select(this)
                .append("title")
                .text(
                  `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
            });

          function updatePositions() {
            circles
              .attr("cx", (d) => getCoords(d).cx)
              .attr("cy", (d) => getCoords(d).cy);
          }

          updatePositions();
          map.on("move", updatePositions);
          map.on("zoom", updatePositions);
          map.on("resize", updatePositions);
          map.on("moveend", updatePositions);

          filterTripsbyTime();
          updateCircles();
        });
    })
    .catch((error) => {
      console.error("Error loading JSON:", error);
    });
});