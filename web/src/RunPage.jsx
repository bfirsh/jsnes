import React, { Component } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import config from "./config";
import ControlsModal from "./ControlsModal";
import Emulator from "./Emulator";
import RomLibrary from "./RomLibrary";
import { loadBinary } from "./utils";

function withParams(Component) {
  return (props) => (
    <Component {...props} params={useParams()} location={useLocation()} />
  );
}

/*
 * The UI for the emulator. Also responsible for loading ROM from URL or file.
 */
class RunPage extends Component {
  constructor(props) {
    super(props);
    this.state = {
      romName: null,
      romData: null,
      running: false,
      paused: false,
      controlsModalOpen: false,
      loading: true,
      loadedPercent: 3,
      error: null,
    };
  }

  render() {
    return (
      <div className="overflow-hidden">
        <nav
          className="flex items-center px-4 py-2"
          ref={(el) => {
            this.navbar = el;
          }}
        >
          <div style={{ width: "200px" }}>
            <Link to="/" className="block py-2 px-2 no-underline">
              &lsaquo; Back
            </Link>
          </div>
          <div className="mx-auto">
            <span className="mr-3">{this.state.romName}</span>
          </div>
          <div
            className="flex"
            style={{ width: "200px", justifyContent: "flex-end" }}
          >
            <button
              onClick={this.toggleControlsModal}
              className="border border-white text-white px-3 py-1 bg-transparent hover:bg-white hover:text-black mr-3 cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white"
              disabled={!!this.state.error}
            >
              Controls
            </button>
            <button
              onClick={this.handlePauseResume}
              className="border border-white text-white px-3 py-1 bg-transparent hover:bg-white hover:text-black cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white"
              disabled={!this.state.running}
            >
              {this.state.paused ? "Resume" : "Pause"}
            </button>
          </div>
        </nav>

        <div
          className="relative flex justify-center items-center"
          ref={(el) => {
            this.screenContainer = el;
          }}
        >
          {this.state.error ? (
            <div
              style={{
                position: "absolute",
                width: "70%",
                left: "15%",
                top: "40%",
                color: "white",
                textAlign: "center",
              }}
            >
              {this.state.error}
            </div>
          ) : this.state.loading ? (
            <div
              className="bg-gray-700 rounded"
              style={{
                position: "absolute",
                width: "70%",
                left: "15%",
                top: "48%",
                height: "8px",
              }}
            >
              <div
                className="bg-white rounded h-full transition-all"
                style={{ width: this.state.loadedPercent + "%" }}
              />
            </div>
          ) : this.state.romData ? (
            <Emulator
              romData={this.state.romData}
              paused={this.state.paused}
              onError={this.handleEmulatorError}
              ref={(emulator) => {
                this.emulator = emulator;
              }}
            />
          ) : null}

          {/* TODO: lift keyboard and gamepad state up */}
          {this.state.controlsModalOpen && (
            <ControlsModal
              isOpen={this.state.controlsModalOpen}
              toggle={this.toggleControlsModal}
              keys={this.emulator.keyboardController.keys}
              setKeys={this.emulator.keyboardController.setKeys}
              promptButton={this.emulator.gamepadController.promptButton}
              gamepadConfig={this.emulator.gamepadController.gamepadConfig}
              setGamepadConfig={
                this.emulator.gamepadController.setGamepadConfig
              }
            />
          )}
        </div>
      </div>
    );
  }

  componentDidMount() {
    window.addEventListener("resize", this.layout);
    this.layout();
    this.load();
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.layout);
    if (this.currentRequest) {
      this.currentRequest.abort();
    }
  }

  load = () => {
    if (this.props.params.slug) {
      const slug = this.props.params.slug;
      const isLocalROM = /^local-/.test(slug);
      const romHash = slug.split("-")[1];
      const romInfo = isLocalROM
        ? RomLibrary.getRomInfoByHash(romHash)
        : config.ROMS[slug];

      if (!romInfo) {
        this.setState({ error: `No such ROM: ${slug}` });
        return;
      }

      if (isLocalROM) {
        this.setState({ romName: romInfo.name });
        const localROMData = localStorage.getItem("blob-" + romHash);
        this.handleLoaded(localROMData);
      } else {
        this.setState({ romName: romInfo.description });
        this.currentRequest = loadBinary(
          romInfo.url,
          (err, data) => {
            if (err) {
              this.setState({ error: `Error loading ROM: ${err.message}` });
            } else {
              this.handleLoaded(data);
            }
          },
          this.handleProgress,
        );
      }
    } else if (this.props.location.state && this.props.location.state.file) {
      let reader = new FileReader();
      reader.readAsBinaryString(this.props.location.state.file);
      reader.onload = (e) => {
        this.currentRequest = null;
        this.handleLoaded(reader.result);
      };
    } else {
      this.setState({ error: "No ROM provided" });
    }
  };

  handleProgress = (e) => {
    if (e.lengthComputable) {
      this.setState({ loadedPercent: (e.loaded / e.total) * 100 });
    }
  };

  handleLoaded = (data) => {
    this.setState({ running: true, loading: false, romData: data });
  };

  handlePauseResume = () => {
    this.setState({ paused: !this.state.paused });
  };

  layout = () => {
    let navbarHeight = parseFloat(window.getComputedStyle(this.navbar).height);
    this.screenContainer.style.height = `${
      window.innerHeight - navbarHeight
    }px`;
    if (this.emulator) {
      this.emulator.fitInParent();
    }
  };

  handleEmulatorError = (error) => {
    this.setState({
      error: `The game has crashed: ${error.message}`,
      running: false,
      paused: false,
    });
  };

  toggleControlsModal = () => {
    this.setState({ controlsModalOpen: !this.state.controlsModalOpen });
  };
}

export default withParams(RunPage);
