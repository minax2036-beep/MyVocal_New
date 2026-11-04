cmake_minimum_required(VERSION 3.16)
project(MyVocalWasm LANGUAGES CXX)

add_executable(myvocal_engine engine.cpp)
target_compile_features(myvocal_engine PRIVATE cxx_std_17)
target_compile_options(myvocal_engine PRIVATE -O3 -Wall -Wextra)

if(EMSCRIPTEN)
  set_target_properties(myvocal_engine PROPERTIES OUTPUT_NAME "engine" SUFFIX ".js")
  target_link_options(myvocal_engine PRIVATE
    "-sWASM=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createMyVocalEngine"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sENVIRONMENT=web"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_processed_length','_process_audio','_analyze_f0']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF32']"
  )
endif()
