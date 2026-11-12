# Mapping rural healthcare access in Maharashtra

An exploratory geospatial analysis of road-network access from habitations to medical facilities in Maharashtra, followed by a clustering-based assessment of potential new facility locations. The repository contains a cleaned-for-publication copy of the author's Colab notebook, selected historical outputs and a PlantUML workflow description. It is a research prototype, **not a validated site-selection or routing system**.

## Repository status

The notebook is preserved as an archival working copy: its code and narrative are unchanged, but saved cell outputs, execution counts and Colab provenance were removed to avoid publishing data samples, transient service URLs and IP addresses. Historical narrative in the notebook can disagree with the code or saved run. The original input layers and original interactive HTML map are not included. Two older output shapefiles and a new interactive explorer built from them are included for inspection, not as verified inputs to this notebook. A fresh end-to-end run has **not** been verified; use the reconciliation checklist below before execution.

## Method

1. Read habitation points, facilities and roads; filter facilities to `FAC_CATEGO == "Medical"` and exclude descriptions similar to veterinary terms. Clean coordinates and project to **EPSG:7767 (WGS 84 / Maharashtra)**, a metre-based CRS. The notebook's code comment calls it Kalianpur 1975; that comment is incorrect.
2. Clip roads to the points' bounding envelope plus 20 km. Snap points within 5 km of a road, split road segments and build an undirected, length-weighted NetworkX graph. Candidate facilities are the five nearest in straight-line space. Dijkstra distances include point-to-road connectors; fallbacks handle disconnected components.
3. Classify a habitation as served if its recorded distance is at most 5 km; distances above 5 km and missing paths are underserved.
4. Apply unweighted DBSCAN to underserved points (`eps=5000` metres, `min_samples=10`). Within each non-noise cluster, use K-means with an elbow heuristic for larger groups and a size rule for smaller groups. Proposals are subcluster centroids associated with nearest graph nodes, **not** the network medoids described in parts of the notebook. A medoid helper exists but is not used in placement.
5. Add synthetic connections between disconnected components, calculate multi-source network distances to existing and proposed facilities, then export layers and produce a Folium/Gradio dashboard. The displayed region-of-need polygons are convex hulls, not administrative or catchment boundaries.

The workflow diagram is maintained in [PlantUML](docs/workflow.puml). Render it locally with a PlantUML installation, for example `plantuml -tsvg docs/workflow.puml`; GitHub does not render PlantUML source directly.

## Shapefile inventory

Shapefiles are multi-file datasets: keep matching `.shp`, `.shx`, `.dbf`, and `.prj` together, plus `.cpg` when supplied. Inputs must have an appropriate CRS and the fields listed below. Do not assume another file with a similar name has the same schema or provenance.

| Shapefile | Contents |
| --- | --- |
| `Facilities.shp` | Raw facility points, including `FACILITY_I`, `FAC_CATEGO` and `FAC_DESC`. |
| `Habitation.shp` | Raw habitation points identified by `HAB_ID`. |
| `gis_osm_roads_free_1.shp` | Road-network line geometries used for routing. |
| `Facilities_cleaned.shp` | Facility points retained after medical-category and veterinary-name filtering. |
| `habitations_with_path_info.shp` | Habitation points with path availability, facility identifiers and distance information. |
| `shortest_paths.shp` | Route geometries from the notebook's network analysis. |
| `maharashtra_habitation_service_levels.shp` | Habitations classified as served or underserved using the distance threshold. |
| `habs_proposals_eps5000_mins10_validated.shp` | Clustered habitations with proposed-scenario assignments and distance information; DBSCAN noise is excluded. |
| `facilities_eps5000_mins10_final.shp` | Proposed facility locations from hierarchical clustering. |
| `hierarchical_analysis_network.shp` | Augmented road-network edges used for the proposal analysis. |
| `shortest_road_paths.shp` | Historical route lines with habitation and facility identifiers and path lengths. |

The original input shapefiles and several notebook outputs were not found in the Drive search. The two historical shapefiles included below are not verified substitutes for the current run. Obtain the original inputs and check their licence and permission before using or sharing them.

### Included historical outputs

- [`results/historical-network/habitations_with_path_info.shp`](results/historical-network/habitations_with_path_info.shp): 85,990 points, with `HAB_ID`, `path_found`, `nearest_fa`, `path_len_m` and `reason_no_`. The older layer lacks the `path_type` field used by the current dashboard.
- [`results/historical-network/shortest_road_paths.shp`](results/historical-network/shortest_road_paths.shp): 51,506 polylines, with `HAB_ID`, `FACILITY_I` and `path_len_m`. Both layers have a WGS 84 / Maharashtra projection file and matching `.shx`, `.dbf`, `.prj` and `.cpg` sidecars. They come from the same older Drive folder, but their generation method and compatibility with this notebook's later run are unknown; do not silently rename or substitute them. Open them in QGIS or read them with GeoPandas using the `.shp` paths.

### Explore the historical outputs on a map

The [historical network explorer](maps/) is a read-only visualization of the included historical outputs, **not** the missing original Folium/Gradio dashboard. It colors 2011 district polygons by the percentage of assigned habitation records flagged as having no path. Click a district for counts, or choose one from the search dropdown. District colors and counts always use **all** records assigned to the district; the status checkboxes filter individual points only, which appear at zoom level 11 and above. Search by habitation name, optionally restricting results to a district; IDs are displayed to distinguish same-named records and remain available as a fallback search. Some names are unavailable; the search returns up to 30 matches and prompts you to refine broad searches.

The 35 district boundaries are [DataMeet's 2011 district dataset](https://github.com/datameet/maps/tree/master/Districts/Census_2011), shared under [CC BY 2.5 India](https://creativecommons.org/licenses/by/2.5/in/) by the DataMeet community; see its [source and licence notes](https://github.com/datameet/maps/blob/master/Districts/README.md). Boundaries and names are historical, not authoritative for current administrative decisions: for example Palghar was created after 2011. The district shapes are generalized and may not exactly follow the habitation source geometry. Spatial assignment uses the original polygon geometry in WGS 84 and includes points on a boundary only if exactly one district covers them. Of 85,990 point records, **85,671** were uniquely assigned and **319** were outside or ambiguous; the latter are excluded from district totals but remain in the overall totals and search. Districts with no assigned records are gray. Counts represent records, not population or deduplicated settlements. A missing path does not prove inaccessibility.

**Screened medical destinations and routes.** Habitations use house symbols, colored by their **original, unfiltered** recorded path status. Purple squares with a plus show matched historical destinations that pass a conservative human-medical description screen, at zoom 12 and above. A unique selected habitation's destination is highlighted if its route passes the same screen; routes to non-medical, ambiguous or unmatched destinations are hidden. The original point statuses, distances, sidebar counts and district shares are **not recalculated** against this medical subset: many recorded destinations match non-medical facilities, so these statistics do not establish human healthcare access.

To construct the subset we match historical `FACILITY_I` to [DataMeet's PMGSY Maharashtra Facilities layer](https://github.com/datameet/pmgsy-geosadak/blob/master/data/Facilities/Maharashtra.zip) when a unique same-ID source record is within 1 metre of a route endpoint in EPSG:7767. Of 51,506 routes, 51,502 match 32,446 unique source destinations. The source category `Medical` includes veterinary facilities, so the reproducible script additionally excludes recognizable animal/veterinary descriptions and requires a human-medical signal such as PHC, CHC, primary/community health, arogya, nursing home or rural hospital. This conservative name-based screen retains **1,036 destination candidates and 1,774 matched routes**. It excludes unclear descriptions and may miss valid centers; misspellings and misleading source names may also defeat the filter. It is not a verification of facility type, operational status, provenance or access. These are historical candidates, **not** proposed facilities or a complete facility inventory. The original historical files remain unchanged.

The **Nearby paths to screened medical destinations** layer loads only eligible path geometries whose projected bounding boxes intersect the current view, at zoom 12 or closer. It uses a server-side in-memory bounding-box index and reads the original shapefile geometries on demand, with no geometry simplification or silent sampling (coordinates are transformed to WGS 84 and rounded to six decimal places). Bounding-box candidates can include paths outside the view. If more than 400 candidates or 100,000 vertices are found, the map draws none and asks you to zoom closer. The overlay can be switched off without affecting a selected habitation's blue path. This is a visualization of **screened historical routes**, not the complete road network: routes can overlap, omit roads and contain non-road connectors, and must not be used for navigation. The notebook's matching road input is not available; substituting a different road dataset would not reproduce it.

The actual proposal facilities, proposal assignments and matching augmented network are unavailable in the accessible files. Consequently the explorer does not display proposed facility locations or shortest paths to them. If available, provide the complete `facilities_eps5000_mins10_final` and `habs_proposals_eps5000_mins10_validated` shapefile sets, the matching `hierarchical_analysis_network` (or equivalent final-network) shapefile set, and any exported proposed-route geometries from the **same run**. If route geometry was not exported, reconstruction must be checked against that run's node assignments, graph construction and distance outputs; existing-facility historical routes are not a substitute. The two saved notebook runs report different proposal counts and must not be combined.

Habitation names were matched to [DataMeet's PMGSY Maharashtra habitation layer](https://github.com/datameet/pmgsy-geosadak/blob/master/data/Habitation/Maharashtra.zip) by matching `HAB_ID` and a WGS 84 location within 30 metres. In the checked source, matched coordinates agree to within a tiny fraction of a metre. A name is shown only when all nearby source candidates agree and the name is not blank: **85,107** records are named, while **883** are unnamed or ambiguous. This match does not establish the full provenance of the historical analysis outputs. A blue line is a screened route matched by ID, not a guarantee of navigability. The point data contain duplicate habitation IDs, so route matches for those IDs are explicitly marked uncertain. Some path-found points have no matching route geometry. No proposed facility or service-level output is inferred from these files.

To run locally from the repository root, with Python 3.10 or newer and pip:

```bash
python -m venv .venv
# Activate the environment: source .venv/bin/activate (Windows: .venv\Scripts\activate)
python -m pip install pyshp==3.1.8 pyproj==3.7.2
python maps/serve_map.py
```

Open `http://127.0.0.1:8000/` in your browser. Use Ctrl+C to stop the server. The server reads the original projected shapefiles and transforms coordinates to WGS 84 for display; it binds to the local machine by default and has no authentication. Do not expose it publicly without appropriate controls. Leaflet and the context map are included locally: no external map tiles are requested. The outlines and place labels are extracts of the generalized 1:50m Natural Earth [admin-1](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_1_states_provinces.geojson) and [populated places](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_populated_places.geojson) datasets (public domain). These are for orientation, not authoritative boundaries or a basis for analysis, and do not provide street-level detail. The map itself requires the server and cannot be opened directly as a standalone HTML file. Leaflet is distributed under its included [BSD 2-Clause license](maps/vendor/leaflet/LICENSE).

Run the data/API smoke tests with `python -m unittest discover -s tests -v` after installing those dependencies, and the aggregation tests with `node tests/test_districts.js` (Node.js required).

The checked-in derived files `maps/districts-2011.geojson` and `maps/habitation-reference.json` can be rebuilt with `maps/prepare_reference_data.py` from the two upstream shapefile sets cited above, using `pyshp`, `pyproj` and Shapely 2. For example, after installing Shapely 2 and downloading and unpacking those datasets:

```bash
python maps/prepare_reference_data.py --habitations /path/to/Habitation.shp --districts /path/to/2011_Dist.shp
```

The historical destination lookup can also be rebuilt with `python maps/prepare_facility_reference.py --facilities /path/to/Facilities.shp`, using the PMGSY Maharashtra facility archive cited above. It stores source and route hashes; the server checks the route hashes before serving the data.

Keep each shapefile's `.shp`, `.shx`, `.dbf` and `.prj` sidecars together. The lookup records source hashes and the historical output hashes; the server refuses to use it if the historical shapefiles change without rebuilding the lookup. District assignments and name matches depend on the specific versions of those input datasets and on their coordinate accuracy.

Counts in the sidebar are counts of records, not deduplicated settlements: 49,843 with a reported found path at or below 5 km, 1,760 with a reported found path above 5 km, and 34,387 with no path found. The 51,603 path-found records are flags in the point layer, not a count of route geometries (the route layer has 51,506 features). A missing path is not evidence that a facility is inaccessible. Distances and path flags are inherited from the older files; their calculation and source data have not been independently validated. This explorer does not recreate the notebook's proposal scenario, and its results should not be treated as a current assessment or used for navigation or site selection.

### Data sources and attribution

The project final report identifies [DataMeet's PMGSY GeoSadak repository](https://github.com/datameet/pmgsy-geosadak) as the source of its habitation, facility and road layers; the separate project documentation describes habitation and road data as coming from that repository and facilities as government-provided. The notebook itself reads prepared local shapefiles rather than a traceable upstream revision. The report's source descriptions therefore do **not** establish the exact upstream files, versions or transformations behind these historical outputs. In particular, `gis_osm_roads_free_1.shp` in the notebook has an OSM-style name; its precise publisher and relationship to the PMGSY roads have not been verified. Do not treat a PMGSY road archive as a drop-in replacement.

DataMeet provides state archives for [habitations](https://github.com/datameet/pmgsy-geosadak/tree/master/data/Habitation), [facilities](https://github.com/datameet/pmgsy-geosadak/tree/master/data/Facilities), and [roads](https://github.com/datameet/pmgsy-geosadak/tree/master/data/Road_DRRP). Their README requests the following citation for its PMGSY data:

> Ministry of Rural Development, 2022. PMGSY Rural Connectivity Datasets, https://geosadak-pmgsy.nic.in/opendata/. Published under India's [Government Open Data License](https://data.gov.in/government-open-data-license-india).

Consult the [upstream README](https://github.com/datameet/pmgsy-geosadak#readme) and [archived terms](https://github.com/datameet/pmgsy-geosadak/blob/master/PMGSY-TnC-archived.html) for attribution and reuse conditions. Check any additional rights for the actual road source and basemap once identified. No licence or specific GitHub origin is asserted for unknown inputs. The historical shapefiles are analysis outputs, not copies of the raw GitHub archives.

## Setup and execution

**Recommended environment:** Google Colab with access to My Drive. The original runtime logs identified Python 3.12, GeoPandas 1.1.1, Shapely 2.1.1, NetworkX 3.5 and momepy 0.10.0; these are observations, not a tested lockfile. The notebook uses Colab magics and Drive mounting, and is not directly portable to local Jupyter. Full-state runs can be memory-intensive.

1. Open `notebooks/maharashtra_healthcare_accessibility.ipynb` in Colab. Make your own copy and mount Drive in the first cell. Work on copies of the inputs and use a new output directory to avoid overwriting prior results.
2. Obtain the three source shapefile sets above, preserving all sidecars and expected field names. Update **every** corresponding input path in the notebook to point to your copies. Confirm geometry, unique IDs, CRS and data provenance in QGIS or GeoPandas. The cleaning cells assume geographic longitude/latitude bounds; do not feed them projected coordinates without revising those checks.
3. Run the notebook's installation cells. Its import cell additionally needs packages commonly preinstalled in Colab. If missing, install them in a cell:

   ```python
   %pip install geopandas pandas numpy scipy scikit-learn shapely seaborn requests gradio
   ```

   The dashboard also runs `npm install -g localtunnel`, so Node.js/npm and network access are needed for that optional section. Dependency versions are not locked; API compatibility is not guaranteed.
4. Reconcile the notebook issues below in your copy **before** running sequentially. Then run preprocessing, network analysis, service classification and facility proposal cells in order, checking the printed status and file creation after each stage. These stages reuse `_CONFIG`, so rerun each relevant configuration cell before its stage. Some exceptions are caught and printed rather than raised; an apparently completed cell does not prove success.
5. Optionally run the dashboard cells only after validating the output files. They start an HTTP server, a localtunnel and `gradio.launch(share=True)`, exposing the map via public services. Do not run them with sensitive data or on an untrusted network; review sharing and access controls first. The final cell can remain running until interrupted.

### Reconciliation checklist for the archived notebook

- The early `gdf_habitation_with_path` read and its `.info()` cell depend on a previous output before it is generated. Skip them for a fresh run.
- In the Shapely imports, add `split` and `snap` from `shapely.ops`; the road-splitting helper uses those names. Otherwise its broad exception handler can silently retain unsplit roads.
- The point-cleaning cell applies the habitation validity mask to facilities by index, and uses `or` when both dataframes are needed. Replace it with independent validity checks for each layer and a guard requiring both; check null/empty/invalid geometries and valid longitude as well as latitude. The road-cleaning cell stores `gdf_roads_cleaned`, but later cells use `gdf_roads`; explicitly decide whether to use the cleaned result and verify the input CRS before its degree-based checks.
- The network stage writes to a different location from the one used by the service-level configuration and dashboard. Align those locations with the run you actually intend to use. Create the cleaned-roads output directory before the network stage; the export does not create it. The service-level code also checks for `shortest_paths.shp` even though classification reads the path-info layer.
- The proposal configuration reads service levels from a different location from the service-level output. The dashboard also reads proposed facilities from a different location than the proposal output; align these locations before running. Verify shapefile field truncation, including `service_le`, `nearest_fa` and `net_reduc_`, before running downstream cells.
- Outputs are saved only if the proposal stage finds positive reductions; check its log and rerun selectively rather than assuming all products exist. Long network operations may require substantial RAM and runtime. Avoid rerunning cells that write to existing paths without backups.

## Interpretation and limitations

- Five nearest straight-line candidates do not guarantee the globally nearest facility by network distance. The main-grid fallback uses straight-line distance when the network is disconnected, not an actual drivable route. Synthetic bridges used in the proposal analysis are not observed roads and may cross impassable terrain. Treat fallback and bridged results separately from connected-road paths.
- The before and after distances use different graph construction and snapping approaches. They are not necessarily directly comparable; validate connectors, graph topology, intersections, disconnected components and CRS distortion before reporting impacts. Road direction, travel time, mode, terrain, seasonal access, facility capacity and service quality are not modeled.
- DBSCAN noise is excluded from saved clustered outputs; remote settlements should not be interpreted as served or ignored in planning. Proposed centroids/node associations are screening candidates, not feasible sites: assess land, service demand, equity, costs and local knowledge. The geometric silhouette score is not a measure of network accessibility.
- The archived notebook contains inconsistent historical figures and hard-coded dashboard claims (including 346 versus 381 proposals). These are not independently reproducible evidence. Recompute and validate all statistics from a consistent run before publication or policy use.
