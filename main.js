let map = L.map('map', {
    center: [-0.92, 37.11],
    zoom: 14,
    scrollWheelZoom: true,  // allow zooming with mouse wheel
    doubleClickZoom: true,  // allow zoom on double click
    dragging: true,         // allow panning by dragging
    touchZoom: true,        // allow pinch zoom on touch
    boxZoom: true,          // allow zoom by dragging box
    keyboard: true          // allow keyboard arrows to pan
});


L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let parcelsLayer;
let selectedParcelLayer;
let activePopup;
let routingControl;
let userMarker;
let lastUserLocation = null;
let watchId = null;
let activeRoutePopup = null;



// ---------------- Load parcels ----------------
fetch('data/parcels.geojson')
    .then(res => res.json())
    .then(data => {
        parcelsLayer = L.geoJSON(data, {
            style: { color: "#ff7800", weight: 2, opacity: 0.7, fillOpacity: 0.2 },
            onEachFeature: (feature, layer) => {
                layer.on('click', () => handleParcelSelection(layer));
            }
        }).addTo(map);
    });

// ---------------- Highlight parcel ----------------
function highlightParcel(layer) {
    parcelsLayer.resetStyle();
    layer.setStyle({ color: 'blue', weight: 3, fillOpacity: 0.3 });
}

// ---------------- Clear previous selection ----------------
function clearPreviousSelection() {
    if (activePopup) {
        map.closePopup(activePopup);
        activePopup = null;
    }
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    document.getElementById("route-info").innerHTML = "";
    parcelsLayer.resetStyle();
}

// ---------------- Handle parcel selection (click or search) ----------------
function handleParcelSelection(layer) {
    clearPreviousSelection();
    selectedParcelLayer = layer;
    highlightParcel(layer);

    const props = layer.feature.properties;
    const parcelNumber = props.parcel_num.split("/")[1];

    // Popup
    activePopup = L.popup()
        .setLatLng(layer.getBounds().getCenter())
        .setContent(`<strong>Parcel:</strong> ${parcelNumber}<br><strong>Acreage:</strong> ${props.acreage}`)
        .openOn(map);

    map.fitBounds(layer.getBounds(), { maxZoom: 18 });

    // Prompt routing
    setTimeout(() => promptRouting(layer), 300);
}

// ---------------- Prompt user for routing ----------------
function promptRouting(layer) {
    if (confirm("Do you want directions to this parcel?")) {
        startRouting();
    }
}

// ---------------- Start routing (watch once) ----------------
function startRouting() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    if (!watchId) {
        watchId = map.locate({ setView: false, watch: true, maxZoom: 18 });
        map.on('locationfound', onLocationFound);
    } else {
        // Already watching location, force route update immediately
        if (selectedParcelLayer) updateRoute(lastUserLocation, selectedParcelLayer);
    }
}

// ---------------- Location update ----------------
function onLocationFound(e) {
    const userLatLng = e.latlng;

    if (!lastUserLocation || userLatLng.distanceTo(lastUserLocation) > 160) {
        lastUserLocation = userLatLng;

        if (!userMarker) {
            userMarker = L.marker(userLatLng).addTo(map).bindPopup("You are here").openPopup();
        } else {
            userMarker.setLatLng(userLatLng);
        }

        if (selectedParcelLayer) {
            updateRoute(userLatLng, selectedParcelLayer);
        }
    }
}

// ---------------- Update routing ----------------
function updateRoute(userLatLng, parcelLayer) {
    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
        waypoints: [userLatLng, parcelLayer.getBounds().getCenter()],
        lineOptions: { styles: [{ color: 'red', weight: 4 }] },
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false
    }).addTo(map);

    routingControl.on('routesfound', e => {
        const route = e.routes[0];
        const summary = route.summary;
		
		// Zoom the map to fit the route
		const routeBounds = L.latLngBounds(route.coordinates);
		map.fitBounds(routeBounds, { padding: [50, 50] });
		
        // Remove previous route popup if exists
		if (activeRoutePopup) {
			map.closePopup(activeRoutePopup);
		}
		
		// Calculate midpoint of the route
		const midpointIndex = Math.floor(route.coordinates.length / 2);
		const midpoint = route.coordinates[midpointIndex];
		
		// Remove previous route popup if exists
		if (activeRoutePopup) {
			map.closePopup(activeRoutePopup);
		}

		activeRoutePopup = L.popup({
			closeButton: true,
			autoClose: false,
			closeOnClick: false,
			className: "route-popup"
		})
		.setLatLng(midpoint)
		.setContent(`
			<strong>Distance:</strong> ${(summary.totalDistance/1000).toFixed(2)} km<br>
			<strong>Estimated time:</strong> ${Math.round(summary.totalTime/60)} mins
		`)
		.openOn(map);
	});
}

// ---------------- Search ----------------
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

// ---------------- Add Parcel Legend ----------------
const legend = L.control({ position: 'bottomleft' });

legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `
        <div class="legend-item">
            <div class="legend-color" style="background:#ff7800;"></div>
            Parcel
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:blue;"></div>
            Selected Parcel
        </div>
    `;
    return div;
};

legend.addTo(map);
