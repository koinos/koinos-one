#pragma once
#include <winsock2.h>
#include <windows.h>

// Undefine Windows macros that conflict with protobuf and other libraries
#ifdef GetMessage
#undef GetMessage
#endif
#ifdef SendMessage
#undef SendMessage
#endif
#ifdef GetObject
#undef GetObject
#endif
#ifdef CreateService
#undef CreateService
#endif
#ifdef DeleteService
#undef DeleteService
#endif
