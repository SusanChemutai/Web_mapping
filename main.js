// ================= MAP INIT =================
let map = L.map('map', {
    center: [-0.92, 37.11],
    zoom: 14,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    dragging: true,
    touchZoom: true,
    boxZoom: true,
    keyboard: true
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ================= GLOBALS =================
let parcelsLayer;
let selectedParcelLayer;
let routingControl;
let userMarker;
let lastUserLocation = null;
let watchId = null;
let activePopup = null;
let activeRoutePopup = null;
let accessPointMarker = null;

// ================= LOAD PARCELS =================
fetch('data/parcels.geojson')
    .then(res => res.json())
    .then(data => {
        parcelsLayer = L.geoJSON(data, {
            style: {
                color: "#ff7800",
                weight: 2,
                opacity: 0.7,
                fillOpacity: 0.2
            },
            onEachFeature: (feature, layer) => {
                layer.on("click", () => handleParcelSelection(layer));
            }
        }).addTo(map);
    });

// ================= GEOMETRY HELPERS =================

// True polygon centroid (routing hint only)
function getParcelCentroid(layer) {
    const centroid = turf.centroid(layer.toGeoJSON());
    return L.latLng(
        centroid.geometry.coordinates[1],
        centroid.geometry.coordinates[0]
    );
}

// Parcel boundary buffered by X meters
function getParcelBoundaryBuffer(layer, bufferMeters = 20) {
    const parcel = layer.toGeoJSON();
    const boundary = turf.polygonToLine(parcel);
    return turf.buffer(boundary, bufferMeters, { units: "meters" });
}

// Find route ∩ parcel-boundary-buffer intersection
function getBoundaryAccessPoint(routeCoords, parcelLayer, bufferMeters = 20) {
    const routeLine = turf.lineString(
        routeCoords.map(c => [c.lng, c.lat])
    );

    const boundaryBuffer = getParcelBoundaryBuffer(parcelLayer, bufferMeters);
    const intersections = turf.lineIntersect(routeLine, boundaryBuffer);

    if (!intersections.features.length) return null;

    // Choose intersection closest to parcel centroid
    const centroid = turf.centroid(parcelLayer.toGeoJSON());
    let best = null;
    let minDist = Infinity;

    intersections.features.forEach(pt => {
        const d = turf.distance(centroid, pt, { units: "meters" });
        if (d < minDist) {
            minDist = d;
            best = pt;
        }
    });

    return L.latLng(
        best.geometry.coordinates[1],
        best.geometry.coordinates[0]
    );
}

// ================= UI HELPERS =================
function highlightParcel(layer) {
    parcelsLayer.resetStyle();
    layer.setStyle({
        color: "blue",
        weight: 3,
        fillOpacity: 0.3
    });
}

function clearPreviousSelection() {
    if (activePopup) map.closePopup(activePopup);
    if (activeRoutePopup) map.closePopup(activeRoutePopup);
    if (routingControl) map.removeControl(routingControl);
    if (accessPointMarker) map.removeLayer(accessPointMarker);

    activePopup = null;
    activeRoutePopup = null;
    routingControl = null;
    accessPointMarker = null;

    parcelsLayer.resetStyle();
}

// ================= PARCEL SELECTION =================
function handleParcelSelection(layer) {
    clearPreviousSelection();
    selectedParcelLayer = layer;
    highlightParcel(layer);

    const props = layer.feature.properties;
    const parcelNumber = props.parcel_num.split("/")[1];

    activePopup = L.popup()
        .setLatLng(layer.getBounds().getCenter())
        .setContent(`
            <strong>Parcel:</strong> Murang'a Block 1/${parcelNumber}<br>
            <strong>Acreage:</strong> ${props.acreage}
        `)
        .openOn(map);

    map.fitBounds(layer.getBounds(), { maxZoom: 18 });

    setTimeout(() => {
        if (confirm("Do you want directions to this parcel?")) {
            startRouting();
        }
    }, 300);
}

// ================= GEOLOCATION =================
function startRouting() {
    if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
    }

    if (!watchId) {
        watchId = map.locate({
            watch: true,
            setView: false,
            maxZoom: 18
        });
        map.on("locationfound", onLocationFound);
    } else if (lastUserLocation && selectedParcelLayer) {
        updateRoute(lastUserLocation, selectedParcelLayer);
    }
}

function onLocationFound(e) {
    const userLatLng = e.latlng;

    if (!lastUserLocation || userLatLng.distanceTo(lastUserLocation) > 150) {
        lastUserLocation = userLatLng;

        if (!userMarker) {
            userMarker = L.marker(userLatLng)
                .addTo(map)
                .bindPopup("You are here")
                .openPopup();
        } else {
            userMarker.setLatLng(userLatLng);
        }

        if (selectedParcelLayer) {
            updateRoute(userLatLng, selectedParcelLayer);
        }
    }
}

// ================= ROUTING =================
function updateRoute(userLatLng, parcelLayer) {
    if (routingControl) map.removeControl(routingControl);

    // FIRST PASS: route toward parcel interior (hint only)
    routingControl = L.Routing.control({
        waypoints: [userLatLng, getParcelCentroid(parcelLayer)],
        lineOptions: { styles: [{ color: "red", weight: 4 }] },
        addWaypoints: false,
        draggableWaypoints: false,
        routeWhileDragging: false,
        show: false
    }).addTo(map);

    routingControl.on("routesfound", e => {
        const route = e.routes[0];
        const summary = route.summary;

        // TRUE ACCESS: route ∩ parcel boundary (+20 m)
        const accessPoint = getBoundaryAccessPoint(
            route.coordinates,
            parcelLayer,
            20
        );

        // If boundary access exists, reroute exactly to it
        if (accessPoint) {
            map.removeControl(routingControl);

            routingControl = L.Routing.control({
                waypoints: [userLatLng, accessPoint],
                lineOptions: { styles: [{ color: "red", weight: 4 }] },
                addWaypoints: false,
                draggableWaypoints: false,
                routeWhileDragging: false,
                show: false
            }).addTo(map);

            accessPointMarker = L.circleMarker(accessPoint, {
                radius: 6,
                color: "green",
                fillColor: "lime",
                fillOpacity: 0.9
            })
            .addTo(map)
            .bindPopup("Parcel access point");
        }

        map.fitBounds(L.latLngBounds(route.coordinates), {
            padding: [50, 50]
        });

        const midpoint =
            route.coordinates[Math.floor(route.coordinates.length / 2)];

        if (activeRoutePopup) map.closePopup(activeRoutePopup);

        activeRoutePopup = L.popup({
            autoClose: false,
            closeOnClick: false,
            className: "route-popup"
        })
        .setLatLng(midpoint)
        .setContent(`
            <strong>Distance:</strong> ${(summary.totalDistance / 1000).toFixed(2)} km<br>
            <strong>Estimated time:</strong> ${Math.round(summary.totalTime / 60)} mins
            ${!accessPoint ? `
                <br><br>
                <span style="color:red;">
                ⚠ THIS PARCEL MAY NOT BE DIRECTLY ACCESSIBLE!
                </span>` : ""}
        `)
        .openOn(map);
    });
}

// ================= SEARCH =================
document.getElementById("parcel-search-btn").addEventListener("click", () => {
    const input = document.getElementById("parcel-search").value.trim();
    if (!input) return;

    clearPreviousSelection();
    const searchId = "Muranga/" + input;
    let found = false;

    parcelsLayer.eachLayer(layer => {
        if (layer.feature.properties.parcel_num === searchId) {
            found = true;
            handleParcelSelection(layer);
        }
    });

    if (!found) alert("Parcel not found!");
});

// ================= LEGEND =================
const legend = L.control({ position: "bottomleft" });

legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = `
        <div class="legend-item">
            <div class="legend-color" style="background:#ff7800;"></div>
            Parcel
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:blue;"></div>
            Selected Parcel
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:green;"></div>
            Boundary Access Point
        </div>
    `;
    return div;
};

legend.addTo(map);
