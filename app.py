from flask import Flask, jsonify, render_template, request

from models import get_metadata, simulate

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/metadata")
def api_metadata():
    return jsonify(get_metadata())


@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    payload = request.get_json(force=True) or {}
    model_id = payload.get("model_id")
    params = payload.get("params") or {}
    try:
        result = simulate(model_id, params)
        return jsonify(result)
    except KeyError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
