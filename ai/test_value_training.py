"""Fast checks of ai/value_training.py on a few games: the training loop's
checkpoints, the material prior, matches and export.

    pytest ai/test_value_training.py
"""

import dataclasses
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
pytest.importorskip("pandas")
pytest.importorskip("sklearn")

import value_training as vt  # noqa: E402

PGN = Path(__file__).parent / "data" / "twic_otb2300.pgn"
TINY = vt.ModelSize("tiny", blocks=1, channels=8)
CFG = dataclasses.replace(vt.PROFILES["smoke"], max_games=80, epochs=3, samples_per_epoch=1500, batch_size=256,
                          head_channels=4, hidden=16, patience=10, match_games=4, match_max_plies=30)
DEVICE = torch.device("cpu")


@pytest.fixture(scope="module")
def data():
    games = vt.load_games(PGN, CFG.max_games)
    rep, checks = vt.replay_and_check(games, CFG)
    clean = vt.clean_games(games, CFG)
    pos = vt.label_positions(rep, games, clean)
    split, _, summary = vt.split_by_game(clean, pos, CFG)
    material_lr = vt.fit_material_model(pos.boards[split == 0], pos.labels[split == 0])
    return pos, split, material_lr


def _train(data, ckpt, crash_after=None, **kwargs):
    pos, split, material_lr = data
    vt.seed_everything(CFG.seed)
    model = vt.build_model(TINY, CFG, vt.material_prior(material_lr))
    loaders = vt.make_loaders(pos, split, CFG, DEVICE)
    calls = [0]
    real = vt.evaluate_probs

    def evaluate(probs, y):              # simulate a disconnect after `crash_after` epochs
        calls[0] += 1
        if crash_after is not None and calls[0] > crash_after:
            raise KeyboardInterrupt
        return real(probs, y)

    vt.evaluate_probs = evaluate
    try:
        history = vt.train(model, loaders, pos.labels[split == 1], CFG, DEVICE, checkpoint_dir=ckpt, **kwargs)
    finally:
        vt.evaluate_probs = real
    return model, history


def _same_weights(a, b):
    return all(torch.equal(x, y) for x, y in zip(a.state_dict().values(), b.state_dict().values()))


def test_untrained_network_is_the_material_model(data):
    pos, split, material_lr = data
    model = vt.build_model(TINY, CFG, vt.material_prior(material_lr))
    vt.check_prior(model, pos.boards[split == 1][:500], material_lr, DEVICE)


def test_resumed_training_matches_an_uninterrupted_run(data, tmp_path):
    straight, history = _train(data, tmp_path / "a")
    with pytest.raises(KeyboardInterrupt):
        _train(data, tmp_path / "b", crash_after=1)
    torch.manual_seed(1234)                       # resuming must not depend on the global RNG
    resumed, resumed_history = _train(data, tmp_path / "b")
    assert _same_weights(straight, resumed)
    assert resumed_history["val log loss"].tolist() == history["val log loss"].tolist()


def test_finished_run_reloads_and_changed_settings_restart(data, tmp_path, capsys):
    first, _ = _train(data, tmp_path)
    again, _ = _train(data, tmp_path)
    assert "already trained" in capsys.readouterr().out
    assert _same_weights(first, again)
    _train(data, tmp_path, lr=1e-3)
    assert "different run" in capsys.readouterr().out


def test_matches_and_export(data, tmp_path):
    model, _ = _train(data, None)
    for policy in (vt.network_policy(model, depth=1), vt.network_policy(model, depth=2)):
        match = vt.run_match(policy, vt.greedy_material_policy, CFG.match_games, CFG, DEVICE)
        assert match["win"] + match["draw"] + match["loss"] == pytest.approx(1.0)
    pytest.importorskip("onnxscript")             # the ONNX exporter
    pos, split, _ = data
    sample = torch.from_numpy(vt.ce.encode_boards(pos.boards[:16]))
    entry = vt.export_model(model, TINY, sample, tmp_path, CFG, {"test_log_loss": 1.0})
    manifest = vt.write_web_manifest([entry], tmp_path)
    assert entry["file"] == "value_net_tiny.onnx" and entry["encoding"] == vt.ENCODING
    assert (tmp_path / entry["file"]).exists() and manifest.exists()
