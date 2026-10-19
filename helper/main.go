// lwtree-helper lets the Long War Tech Tree page (https://xcom.innonova.ch)
// read and write the game's files where the browser cannot: an install under
// Program Files, which Chrome refuses to open, or a browser without folder
// access (Firefox, Safari). See features/game-tools.md.
//
// It serves one folder, the game's XComGame folder, on 127.0.0.1 only, to the
// site's pages only (by Origin), and only to a page that has the pairing code
// it prints. It does nothing on its own: every read and write comes from the
// page, after the player has seen and confirmed the plan there.
package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Set by the release build (-ldflags "-X main.version=…").
var version = "dev"

// The pages allowed to use the helper; -origin adds more (a local dev server).
var origins = map[string]bool{
	"https://xcom.innonova.ch": true,
	"https://xcom.aek.dk":      true,
}

const maxWrite = 256 << 20 // the largest package is about 45 MB

func main() {
	dir := flag.String("dir", "", "the game folder (XCom-Enemy-Unknown, its XEW or XEW/XComGame); found by itself if left out")
	port := flag.Int("port", 47801, "the port to listen on (127.0.0.1 only)")
	extra := flag.String("origin", "", "another page origin to allow, e.g. http://localhost:5173")
	flag.Parse()
	if *extra != "" {
		origins[strings.TrimRight(*extra, "/")] = true
	}

	fmt.Printf("Long War Tech Tree helper %s\n\n", version)
	if *dir == "" {
		fmt.Println("Looking for the game...")
	}
	root, err := findGame(*dir, func(p string) { fmt.Println("  " + p) })
	if err != nil {
		fail(err)
	}
	token, err := pairingCode()
	if err != nil {
		fail(err)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fail(fmt.Errorf("cannot listen on %s (is the helper running already?): %w", addr, err))
	}

	fmt.Println()
	fmt.Printf("  Game files:    %s\n", root)
	fmt.Printf("  Pairing code:  %s\n\n", token)
	fmt.Println("In the Tools page, choose \"Use the helper program\" and enter the code.")
	fmt.Println("Keep this window open while the page works with the game; close it when done.")
	fmt.Println()

	srv := &http.Server{
		Handler:           handler(root, token),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.Serve(ln); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "Error:", err)
	if runtime.GOOS == "windows" {
		// Started by a double click: leave the window open long enough to read.
		fmt.Fprintln(os.Stderr, "\nPress Enter to close.")
		_, _ = fmt.Scanln()
	}
	os.Exit(1)
}

// --- Finding the game -------------------------------------------------------

// within runs a look at the disk with a time limit: a drive that does not
// answer (offline, asleep) counts as having nothing rather than holding the
// helper up.
func within[T any](d time.Duration, f func() T) (T, bool) {
	ch := make(chan T, 1)
	go func() { ch <- f() }()
	select {
	case v := <-ch:
		return v, true
	case <-time.After(d):
		var zero T
		return zero, false
	}
}

const lookLimit = 3 * time.Second

func isDir(p string) bool {
	ok, _ := within(lookLimit, func() bool {
		st, err := os.Stat(p)
		return err == nil && st.IsDir()
	})
	return ok
}

func isGameDir(p string) bool {
	return isDir(filepath.Join(p, "CookedPCConsole")) && isDir(filepath.Join(p, "Config"))
}

// gameDirUnder finds XComGame at or below p (the game folder or XEW). Enemy
// Within, and Long War with it, is XEW/XComGame; the game folder's own
// XComGame is Enemy Unknown's, so XEW comes first.
func gameDirUnder(p string) string {
	for _, c := range []string{filepath.Join(p, "XEW", "XComGame"), p, filepath.Join(p, "XComGame")} {
		if isGameDir(c) {
			return c
		}
	}
	return ""
}

var libraryPath = regexp.MustCompile(`"path"\s+"([^"]+)"`)

// regValue reads one value out of `reg query` output
// ("    SteamPath    REG_SZ    c:/program files (x86)/steam").
func regValue(out, name string) string {
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) >= 3 && strings.EqualFold(f[0], name) && strings.HasPrefix(f[1], "REG_") {
			v := strings.TrimSpace(line[strings.Index(line, f[1])+len(f[1]):])
			return filepath.FromSlash(v)
		}
	}
	return ""
}

// registeredSteam: where Windows says Steam is installed (any drive).
func registeredSteam() []string {
	if runtime.GOOS != "windows" {
		if home, err := os.UserHomeDir(); err == nil {
			return []string{filepath.Join(home, ".steam", "steam"), filepath.Join(home, ".local", "share", "Steam")}
		}
		return nil
	}
	var roots []string
	for _, q := range [][2]string{
		{`HKCU\Software\Valve\Steam`, "SteamPath"},
		{`HKLM\SOFTWARE\WOW6432Node\Valve\Steam`, "InstallPath"},
		{`HKLM\SOFTWARE\Valve\Steam`, "InstallPath"},
	} {
		out, ok := within(lookLimit, func() []byte {
			b, _ := exec.Command("reg", "query", q[0], "/v", q[1]).Output()
			return b
		})
		if v := regValue(string(out), q[1]); ok && v != "" {
			roots = append(roots, v)
		}
	}
	return roots
}

// libraries: a Steam folder and the libraries its libraryfolders.vdf lists
// (Steam keeps the list in steamapps, and newer versions in config too).
func libraries(steam string) []string {
	libs := []string{steam}
	for _, f := range []string{filepath.Join("steamapps", "libraryfolders.vdf"), filepath.Join("config", "libraryfolders.vdf")} {
		b, _ := within(lookLimit, func() []byte {
			b, _ := os.ReadFile(filepath.Join(steam, f))
			return b
		})
		for _, m := range libraryPath.FindAllStringSubmatch(string(b), -1) {
			libs = append(libs, strings.ReplaceAll(m[1], `\\`, `\`))
		}
	}
	return libs
}

// findGame looks, in order, at -dir, the folder the helper was started from,
// the libraries of the Steam Windows knows about, then the usual Steam folders
// on the computer's own drives; say reports each library as it goes.
func findGame(given string, say func(string)) (string, error) {
	if given != "" {
		if g := gameDirUnder(given); g != "" {
			return g, nil
		}
		return "", fmt.Errorf("no XComGame folder (with CookedPCConsole and Config) in %s", given)
	}
	if exe, err := os.Executable(); err == nil {
		for d := filepath.Dir(exe); ; d = filepath.Dir(d) {
			if g := gameDirUnder(d); g != "" {
				return g, nil
			}
			if filepath.Dir(d) == d {
				break
			}
		}
	}
	seen := map[string]bool{}
	var looked []string
	try := func(lib string) string {
		k := strings.ToLower(filepath.Clean(lib))
		if seen[k] {
			return ""
		}
		seen[k] = true
		if !isDir(lib) {
			return ""
		}
		dir := filepath.Join(lib, "steamapps", "common", "XCom-Enemy-Unknown")
		say(dir)
		looked = append(looked, "  "+dir)
		return gameDirUnder(dir)
	}
	for _, steam := range registeredSteam() {
		for _, lib := range libraries(steam) {
			if g := try(lib); g != "" {
				return g, nil
			}
		}
	}
	for _, drive := range fixedDrives() {
		for _, sub := range []string{`Program Files (x86)\Steam`, `Program Files\Steam`, "Steam", "SteamLibrary", `Games\Steam`, `Games\SteamLibrary`} {
			for _, lib := range libraries(filepath.Join(drive, sub)) {
				if g := try(lib); g != "" {
					return g, nil
				}
			}
		}
	}
	msg := "could not find the game"
	if len(looked) > 0 {
		msg += "; looked in:\n" + strings.Join(looked, "\n")
	}
	return "", errors.New(msg + "\nStart the helper with -dir \"<the game's folder>\", e.g. lwtree-helper.exe -dir \"D:\\SteamLibrary\\steamapps\\common\\XCom-Enemy-Unknown\"")
}

// --- The pairing code --------------------------------------------------------

// pairingCode is kept between runs, so a page that has it reconnects by itself.
func pairingCode() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		cfg = os.TempDir()
	}
	file := filepath.Join(cfg, "lwtree-helper", "pairing-code")
	if b, err := os.ReadFile(file); err == nil && len(strings.TrimSpace(string(b))) == 9 {
		return strings.TrimSpace(string(b)), nil
	}
	const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	code := make([]byte, 0, 9)
	for i, b := range raw {
		if i == 4 {
			code = append(code, '-')
		}
		code = append(code, letters[int(b)%len(letters)])
	}
	_ = os.MkdirAll(filepath.Dir(file), 0o700)
	_ = os.WriteFile(file, code, 0o600)
	return string(code), nil
}

// --- Serving -----------------------------------------------------------------

// resolve turns a page's path ("CookedPCConsole/XComGame.upk") into a file in
// the game folder, refusing anything outside it; names match whatever their
// case (as on Windows).
func resolve(root, rel string) (string, error) {
	rel = strings.ReplaceAll(rel, `\`, "/")
	if rel == "" || strings.HasPrefix(rel, "/") || strings.Contains(rel, ":") {
		return "", errors.New("bad path")
	}
	p := root
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("bad path")
		}
		next := filepath.Join(p, part)
		if _, err := os.Lstat(next); err != nil {
			if entries, err := os.ReadDir(p); err == nil {
				for _, e := range entries {
					if strings.EqualFold(e.Name(), part) {
						next = filepath.Join(p, e.Name())
						break
					}
				}
			}
		}
		p = next
	}
	if r, err := filepath.Rel(root, p); err != nil || strings.HasPrefix(r, "..") {
		return "", errors.New("bad path")
	}
	return p, nil
}

func handler(root, token string) http.Handler {
	mux := http.NewServeMux()

	// The only call without the code: lets the page see the helper is running.
	mux.HandleFunc("GET /v1/hello", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"app": "lwtree-helper", "version": version})
	})
	mux.HandleFunc("GET /v1/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"root": root, "name": filepath.Base(filepath.Dir(filepath.Dir(root)))})
	})
	mux.HandleFunc("GET /v1/list", func(w http.ResponseWriter, r *http.Request) {
		p, err := resolve(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		names := []string{}
		if entries, err := os.ReadDir(p); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					names = append(names, e.Name())
				}
			}
		}
		writeJSON(w, names)
	})
	mux.HandleFunc("GET /v1/file", func(w http.ResponseWriter, r *http.Request) {
		p, err := resolve(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		f, err := os.Open(p)
		if err != nil {
			http.Error(w, "no such file", http.StatusNotFound)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = io.Copy(w, f)
	})
	mux.HandleFunc("PUT /v1/file", func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get("path")
		p, err := resolve(root, rel)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Written next to the file, then put in its place at once.
		tmp, err := os.CreateTemp(filepath.Dir(p), ".lwtree-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		n, err := io.Copy(tmp, http.MaxBytesReader(w, r.Body, maxWrite))
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
		if err == nil {
			err = os.Rename(tmp.Name(), p)
		}
		if err != nil {
			_ = os.Remove(tmp.Name())
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("wrote %s (%d bytes)", rel, n)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /v1/file", func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get("path")
		p, err := resolve(root, rel)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("removed %s", rel)
		w.WriteHeader(http.StatusNoContent)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !origins[origin] {
			http.Error(w, "this page may not use the helper", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, PUT, DELETE")
			h.Set("Access-Control-Allow-Headers", "X-Lwtree-Code, Content-Type")
			// Chrome asks before a public page may reach a local address.
			h.Set("Access-Control-Allow-Private-Network", "true")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path != "/v1/hello" && r.Header.Get("X-Lwtree-Code") != token {
			http.Error(w, "wrong pairing code", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
