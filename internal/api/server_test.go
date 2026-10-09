package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/kube"
)

const testKubeconfig = `apiVersion: v1
kind: Config
current-context: kind-harbor
clusters:
- name: kind-harbor
  cluster: {server: https://127.0.0.1:6443}
- name: prod
  cluster: {server: https://prod.example:6443}
contexts:
- name: kind-harbor
  context: {cluster: kind-harbor, user: kind-harbor}
- name: prod-admin
  context: {cluster: prod, user: admin, namespace: ops}
users:
- name: kind-harbor
  user: {token: "tok-x"}
- name: admin
  user: {token: "tok-y"}
`

// fakeServer returns a Server whose watcher connects to an in-memory cluster.
func fakeServer(t *testing.T, objs ...corev1.Namespace) *Server {
	t.Helper()
	s := NewServer()
	s.newWatcher = func(ctx context.Context, name string, hub *kube.Hub) (*kube.Watcher, error) {
		if name == "broken" {
			return nil, context.DeadlineExceeded
		}
		client := fake.NewClientset()
		for i := range objs {
			if _, err := client.CoreV1().Namespaces().Create(ctx, &objs[i], metav1.CreateOptions{}); err != nil {
				return nil, err
			}
		}
		w := kube.NewWatcher(name, client, hub)
		if err := w.Start(ctx); err != nil {
			return nil, err
		}
		return w, nil
	}
	t.Cleanup(s.Close)
	return s
}

func TestGetHealth(t *testing.T) {
	h := NewHandler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}
	var got gen.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Status != gen.Ok {
		t.Errorf("status = %q, want ok", got.Status)
	}
}

func TestListContextsFromKubeconfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, []byte(testKubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", path)

	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/contexts", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var got gen.ContextList
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Current != "" {
		t.Errorf("current = %q, want empty before any select", got.Current)
	}
	if len(got.Contexts) != 2 || got.Contexts[0].Name != "kind-harbor" || got.Contexts[1].Name != "prod-admin" {
		t.Fatalf("contexts = %+v", got.Contexts)
	}
	if got.Contexts[1].Namespace == nil || *got.Contexts[1].Namespace != "ops" || got.Contexts[1].User != "admin" {
		t.Errorf("prod-admin = %+v", got.Contexts[1])
	}
}

func TestSelectContextThenSnapshot(t *testing.T) {
	s := fakeServer(t, corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "sandbox"}})
	h := s.Handler()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/snapshot", nil))
	var empty gen.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &empty); err != nil || empty.Context != "" || empty.Pods == nil {
		t.Fatalf("empty snapshot before select: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/contexts/kind-harbor/select", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("select: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/snapshot", nil))
	var snap gen.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	if snap.Context != "kind-harbor" || len(snap.Namespaces) != 1 || snap.Namespaces[0].Name != "sandbox" {
		t.Errorf("snapshot after select: %+v", snap)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/contexts/broken/select", nil))
	if rec.Code != http.StatusGatewayTimeout {
		t.Errorf("broken select: %d, want 504", rec.Code)
	}
	if cur := s.current(); cur == nil || cur.Context != "kind-harbor" {
		t.Error("failed select must leave the previous watcher active")
	}
}

func TestWebSocketStreamsSnapshotThenChanges(t *testing.T) {
	s := fakeServer(t)
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()

	var first gen.WsMessage
	if err := wsjson.Read(ctx, c, &first); err != nil {
		t.Fatal(err)
	}
	if first.Type != gen.WsMessageTypeSnapshot || first.Kind != gen.WsMessageKindSnapshot {
		t.Fatalf("first message = %+v, want snapshot", first)
	}

	// Selecting a context broadcasts a new snapshot to connected clients.
	if err := s.SelectContextByName(ctx, "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	var second gen.WsMessage
	if err := wsjson.Read(ctx, c, &second); err != nil {
		t.Fatal(err)
	}
	if second.Type != gen.WsMessageTypeSnapshot {
		t.Fatalf("after select = %+v, want snapshot", second)
	}
	raw, _ := json.Marshal(second.Obj)
	var snap gen.Snapshot
	if err := json.Unmarshal(raw, &snap); err != nil || snap.Context != "kind-harbor" {
		t.Errorf("snapshot context = %q (%v)", snap.Context, err)
	}
}

func TestWebSocketRejectsForeignOrigin(t *testing.T) {
	srv := httptest.NewServer(NewHandler())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://evil.example"}},
	})
	if err == nil {
		t.Fatal("expected handshake failure for a foreign origin")
	}
}

func TestActionsRequireAContext(t *testing.T) {
	h := NewHandler()
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/deployments"},
		{http.MethodPatch, "/api/deployments/default/web/scale"},
		{http.MethodPatch, "/api/deployments/default/web/mappos"},
		{http.MethodDelete, "/api/deployments/default/web"},
		{http.MethodDelete, "/api/pods/default/web-1"},
		{http.MethodDelete, "/api/workloads/StatefulSet/default/db"},
		{http.MethodDelete, "/api/ingresses/default/gate"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`)))
		if rec.Code != http.StatusConflict {
			t.Errorf("%s %s: status = %d, want 409", tc.method, tc.path, rec.Code)
		}
	}
}

func TestCreateScaleMapPosRoundTrip(t *testing.T) {
	s := fakeServer(t, corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "sandbox"}})
	h := s.Handler()
	ctx := context.Background()
	if err := s.SelectContextByName(ctx, "kind-harbor"); err != nil {
		t.Fatal(err)
	}

	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := do(http.MethodPost, "/api/deployments", `{"ns":"sandbox","name":"web","image":"nginx","replicas":2,"port":80,"mapPos":{"x":3,"y":4}}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created gen.Deployment
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "web" || created.Replicas != 2 || created.MapPos == nil || created.MapPos.X != 3 {
		t.Errorf("created = %+v", created)
	}

	if rec = do(http.MethodPost, "/api/deployments", `{"ns":"sandbox","name":"web","image":"nginx","replicas":2}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate create: %d, want 409", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/deployments", `{"ns":"sandbox","name":"Bad Name","image":"nginx","replicas":2}`); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid name: %d, want 400", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/deployments", `{"ns":"sandbox","name":"x","image":"nginx","replicas":2,"bogus":1}`); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field: %d, want 400", rec.Code)
	}

	if rec = do(http.MethodPatch, "/api/deployments/sandbox/web/scale", `{"replicas":5}`); rec.Code != http.StatusNoContent {
		t.Fatalf("scale: %d %s", rec.Code, rec.Body.String())
	}
	d, err := s.current().Client().AppsV1().Deployments("sandbox").Get(ctx, "web", metav1.GetOptions{})
	if err != nil || *d.Spec.Replicas != 5 {
		t.Errorf("replicas after scale = %v (%v)", d.Spec.Replicas, err)
	}
	if rec = do(http.MethodPatch, "/api/deployments/sandbox/ghost/scale", `{"replicas":1}`); rec.Code != http.StatusNotFound {
		t.Errorf("scale missing: %d, want 404", rec.Code)
	}

	if rec = do(http.MethodPatch, "/api/deployments/sandbox/web/mappos", `{"x":9,"y":1}`); rec.Code != http.StatusNoContent {
		t.Fatalf("mappos: %d %s", rec.Code, rec.Body.String())
	}
	d, _ = s.current().Client().AppsV1().Deployments("sandbox").Get(ctx, "web", metav1.GetOptions{})
	if d.Annotations[kube.MapPosAnnotation] != "9,1" {
		t.Errorf("annotation = %q", d.Annotations[kube.MapPosAnnotation])
	}

	if rec = do(http.MethodDelete, "/api/pods/sandbox/nope", ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete missing pod: %d, want 404", rec.Code)
	}
	if rec = do(http.MethodDelete, "/api/deployments/sandbox/web", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec = do(http.MethodDelete, "/api/deployments/sandbox/web", ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete twice: %d, want 404", rec.Code)
	}
}

func TestPodLogs(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "sandbox"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "web"}}}}
	if _, err := s.current().Client().CoreV1().Pods("sandbox").Create(context.Background(), pod, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pods/sandbox/web-1/logs?tail=50", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("logs: %d %s %q", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != "fake logs" { // what the fake clientset serves
		t.Errorf("body = %q", rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pods/sandbox/web-1/logs?tail=0", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("tail below minimum: %d, want 400", rec.Code)
	}
}

func TestWorkloadRoutes(t *testing.T) {
	s := fakeServer(t)
	ctx := context.Background()
	if err := s.SelectContextByName(ctx, "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	one := int32(1)
	if _, err := s.current().Client().AppsV1().StatefulSets("sandbox").Create(ctx, &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "sandbox"}, Spec: appsv1.StatefulSetSpec{Replicas: &one}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := do(http.MethodPatch, "/api/workloads/StatefulSet/sandbox/db/scale", `{"replicas":2}`); rec.Code != http.StatusNoContent {
		t.Fatalf("scale: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPatch, "/api/workloads/DaemonSet/sandbox/db/scale", `{"replicas":2}`); rec.Code != http.StatusBadRequest {
		t.Errorf("scaling a DaemonSet: %d, want 400", rec.Code)
	}
	if rec := do(http.MethodPatch, "/api/workloads/Pirate/sandbox/db/scale", `{"replicas":2}`); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown kind: %d, want 400", rec.Code)
	}
	if rec := do(http.MethodPatch, "/api/workloads/StatefulSet/sandbox/db/mappos", `{"x":1,"y":2}`); rec.Code != http.StatusNoContent {
		t.Errorf("mappos: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodDelete, "/api/workloads/StatefulSet/sandbox/db", ""); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodDelete, "/api/workloads/StatefulSet/sandbox/db", ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete twice: %d, want 404", rec.Code)
	}
}

func TestCreateStatefulSetAndIngressRoutes(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}
	rec := do(http.MethodPost, "/api/workloads/statefulsets", `{"ns":"sandbox","name":"db","image":"postgres:16","replicas":2,"port":5432,"storage":"1Gi"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create sts: %d %s", rec.Code, rec.Body.String())
	}
	var wl gen.Workload
	if err := json.Unmarshal(rec.Body.Bytes(), &wl); err != nil || wl.Kind != gen.WorkloadKindStatefulSet || wl.Desired != 2 {
		t.Errorf("created = %+v (%v)", wl, err)
	}
	if rec = do(http.MethodPost, "/api/workloads/statefulsets", `{"ns":"sandbox","name":"db","image":"x","replicas":1,"storage":"lots"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad storage: %d, want 400", rec.Code)
	}
	rec = do(http.MethodPost, "/api/ingresses", `{"ns":"sandbox","name":"gate","host":"shop.example","service":"db","port":"5432","tls":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create ingress: %d %s", rec.Code, rec.Body.String())
	}
	var ing gen.Ingress
	if err := json.Unmarshal(rec.Body.Bytes(), &ing); err != nil || !ing.Tls || len(ing.Rules) != 1 || ing.Rules[0].Service != "db" {
		t.Errorf("ingress = %+v (%v)", ing, err)
	}
	if rec = do(http.MethodPost, "/api/ingresses", `{"ns":"sandbox","name":"gate","service":"db","port":"5432"}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate ingress: %d, want 409", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/ingresses", `{"ns":"sandbox","name":"g2","service":"","port":"80"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("missing service: %d, want 400", rec.Code)
	}
}

func TestCreateJobRoute(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	do := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/workloads/jobs", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		s.Handler().ServeHTTP(rec, req)
		return rec
	}
	rec := do(`{"ns":"sandbox","name":"haul","image":"busybox","command":["sh","-c","echo"],"completions":2,"parallelism":2}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create job: %d %s", rec.Code, rec.Body.String())
	}
	var wl gen.Workload
	if err := json.Unmarshal(rec.Body.Bytes(), &wl); err != nil || wl.Kind != gen.WorkloadKindJob || wl.Desired != 2 {
		t.Errorf("created = %+v (%v)", wl, err)
	}
	if rec = do(`{"ns":"sandbox","name":"haul","image":"busybox"}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate: %d, want 409", rec.Code)
	}
	if rec = do(`{"ns":"sandbox","name":"h2","image":"busybox","completions":0}`); rec.Code != http.StatusBadRequest {
		t.Errorf("zero completions: %d, want 400", rec.Code)
	}
}

func TestDeleteIngress(t *testing.T) {
	s := fakeServer(t)
	ctx := context.Background()
	if err := s.SelectContextByName(ctx, "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.current().Client().NetworkingV1().Ingresses("sandbox").Create(ctx, &netv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "gate", Namespace: "sandbox"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/ingresses/sandbox/gate", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/ingresses/sandbox/gate", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("delete twice: %d, want 404", rec.Code)
	}
}

func TestProgressRoutes(t *testing.T) {
	s := NewServer()
	s.SetProgressPath(filepath.Join(t.TempDir(), "progress.json"))
	h := s.Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/progress", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"levels":{}`) {
		t.Fatalf("fresh progress: %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodPut, "/api/progress/academy%2F1", strings.NewReader(`{"stars":2,"bestSeconds":42.5,"hintsUsed":0}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}
	var p gen.Progress
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || p.Levels["academy/1"].Stars != 2 {
		t.Errorf("progress = %+v (%v)", p, err)
	}
	req = httptest.NewRequest(http.MethodPut, "/api/progress/academy%2F1", strings.NewReader(`{"stars":7}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("bad stars: %d, want 400", rec.Code)
	}
}

func TestRootServesFrontendOrPlaceholder(t *testing.T) {
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestServiceRoutes(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}
	rec := do(http.MethodPost, "/api/services", `{"ns":"sandbox","name":"courier","selector":{"app":"courier"},"port":80,"targetPort":8080}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create service: %d %s", rec.Code, rec.Body.String())
	}
	var svc gen.Service
	if err := json.Unmarshal(rec.Body.Bytes(), &svc); err != nil || svc.Selector["app"] != "courier" || len(svc.Ports) != 1 || svc.Ports[0].Port != 80 {
		t.Errorf("service = %+v (%v)", svc, err)
	}
	if rec = do(http.MethodPost, "/api/services", `{"ns":"sandbox","name":"courier","selector":{"app":"courier"},"port":80}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate: %d, want 409", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/services", `{"ns":"sandbox","name":"s2","selector":{},"port":80}`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty selector: %d, want 400", rec.Code)
	}
	if rec = do(http.MethodDelete, "/api/services/sandbox/courier", ""); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec = do(http.MethodDelete, "/api/services/sandbox/courier", ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete twice: %d, want 404", rec.Code)
	}
}

func TestOrdersRoutes(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}
	rec := do(http.MethodPost, "/api/orders", `{"ns":"sandbox","name":"courier-keys","kind":"Secret","data":{"API_KEY":"hush"}}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "hush") {
		t.Error("secret value leaked in the response")
	}
	if rec = do(http.MethodPost, "/api/orders", `{"ns":"sandbox","name":"courier-keys","kind":"Secret","data":{"A":"b"}}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate: %d, want 409", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/orders", `{"ns":"sandbox","name":"x","kind":"Scroll","data":{"A":"b"}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad kind: %d, want 400", rec.Code)
	}
	rec = do(http.MethodGet, "/api/orders?ns=sandbox", "")
	var list []gen.Orders
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list) != 1 || list[0].Keys[0] != "API_KEY" {
		t.Errorf("list: %d %s (%v)", rec.Code, rec.Body.String(), err)
	}
	if rec = do(http.MethodDelete, "/api/orders/Secret/sandbox/courier-keys", ""); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec = do(http.MethodDelete, "/api/orders/Scroll/sandbox/courier-keys", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("bad kind param: %d, want 400", rec.Code)
	}
}

func TestRefitRollbackAndNamespaceRoutes(t *testing.T) {
	s := fakeServer(t)
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := do(http.MethodPost, "/api/deployments", `{"ns":"sandbox","name":"courier","image":"courier:1.0","replicas":1}`); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPatch, "/api/deployments/sandbox/courier/refit", `{"image":"courier:2.0","maxUnavailable":"0"}`); rec.Code != http.StatusNoContent {
		t.Errorf("refit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPatch, "/api/deployments/sandbox/courier/refit", `{"image":""}`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty image: %d, want 400", rec.Code)
	}
	if rec := do(http.MethodPost, "/api/deployments/sandbox/courier/rollback", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("rollback without history: %d, want 400", rec.Code)
	}
	if rec := do(http.MethodPost, "/api/deployments/sandbox/nope/rollback", ""); rec.Code != http.StatusNotFound {
		t.Errorf("rollback unknown: %d, want 404", rec.Code)
	}
	rec := do(http.MethodPost, "/api/namespaces", `{"name":"ferry"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create ns: %d %s", rec.Code, rec.Body.String())
	}
	if rec = do(http.MethodPost, "/api/namespaces", `{"name":"ferry"}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate ns: %d, want 409", rec.Code)
	}
	if rec = do(http.MethodPost, "/api/namespaces", `{"name":"Fe rry"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad ns: %d, want 400", rec.Code)
	}
}
