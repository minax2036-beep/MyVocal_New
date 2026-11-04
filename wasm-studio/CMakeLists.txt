cmake_minimum_required(VERSION 3.16)
project(MyVocalWasm LANGUAGES CXX)

include(FetchContent)

# Pin the upstream WORLD source so browser builds are reproducible.
FetchContent_Declare(
  world
  GIT_REPOSITORY https://github.com/mmorise/World.git
  GIT_TAG c794856b537758a3d300757db2e5e31685a822c2
  GIT_SHALLOW FALSE
)

set(WORLD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WORLD_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_GetProperties(world)
if(NOT world_POPULATED)
  FetchContent_Populate(world)
endif()
add_subdirectory(${world_SOURCE_DIR} ${world_BINARY_DIR} EXCLUDE_FROM_ALL)

add_executable(myvocal_engine world_engine.cpp)
target_compile_features(myvocal_engine PRIVATE cxx_std_17)
target_compile_options(myvocal_engine PRIVATE -O3 -Wall -Wextra)
target_link_libraries(myvocal_engine PRIVATE world)

if(EMSCRIPTEN)
  set_target_properties(myvocal_engine PROPERTIES OUTPUT_NAME "engine" SUFFIX ".js")
  target_link_options(myvocal_engine PRIVATE
    "-sWASM=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createMyVocalEngine"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=134217728"
    "-sENVIRONMENT=web"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_processed_length','_process_audio','_analyze_f0']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF32']"
  )
endif()
