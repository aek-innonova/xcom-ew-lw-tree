//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var getDriveType = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDriveTypeW")

// fixedDrives lists the computer's own hard drives. GetDriveTypeW does not
// touch the media, so network drives that are offline and empty card
// readers cannot hold the search up; they are left out.
func fixedDrives() []string {
	var out []string
	for d := 'C'; d <= 'Z'; d++ {
		root := string(d) + `:\`
		p, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		if t, _, _ := getDriveType.Call(uintptr(unsafe.Pointer(p))); t == 3 { // DRIVE_FIXED
			out = append(out, root)
		}
	}
	return out
}
