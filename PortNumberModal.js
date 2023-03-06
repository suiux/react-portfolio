import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useDispatch, useSelector } from 'react-redux';
import closeIcon from '../../assets/images/close-icon.svg';
import DappsIcon from '../../assets/images/dapps-yellow-rect.svg';
import keyReactangle from '../../assets/images/key-reactangle.svg';
import MonitorIcon from '../../assets/images/monitor-rect.svg';
import codeRect from '../../assets/images/code-cyan.svg';
import WarningIcon from '../../assets/images/warning-icon.svg';
import { useDaemonWebsocket } from '../../hooks/daemonWebsocket';
import { useNodeWebsocket } from '../../hooks/nodeWebsocket';
import { setAlertModal, setAlertModalTo } from '../../reducers/onboarding';
import { setNodeValue } from '../../reducers/wallet';
import { useDNS } from '../../utils/dnsSubvert';
import { Utils } from '../../utils/utils';
import RestartingModal from './RestartingModal';
import { useTranslation } from 'react-i18next';
import { setCountryCode } from '../../reducers/exitNode';
import { setSwitchServing } from '../../reducers/wallet';
import useMousetrap from 'react-hook-mousetrap';
import './PortNumberModal.scss';

let automapFlag = false;

const PortNumberModal = ({
  isOpen,
  handleClose,
  handleSubmit,
  shouldCloseOnOverlayClick = false,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const {
    store,
    socket: {
      node: { isRunning: nodeRunning },
    },
    node: { setup },
  } = useSelector((state) => state.wallet);
  const [restartingSteps, setRestartingSteps] = useState([]);
  const [restartingModalOpen, setRestartingModalOpen] = useState(false);

  const { modifySetup, startNode } = useDaemonWebsocket();
  const { shutdown, configuration, isWebsocketOpen } = useNodeWebsocket();

  const [PortNumber, setPortNumber] = useState(
    store.get('last.clandestine-port')
  );

  const getMyPublicIP = async () => {
    const ipAddr = await Utils.getCurrentIP();
    return ipAddr;
  };
  useMousetrap('enter', () => {
    handleConfirm();
  });
  const handleConfirm = async () => {
    let myPublicIP = null;

    store.set('last.clandestine-port', PortNumber);
    handleClose();

    if (nodeRunning) {
      const steps = [];
      dispatch(setCountryCode(undefined));

      steps.push({
        label:
          store.get('last.neighborhoodMode') == 'standard'
            ? 'Test router port-forwarding on port ' +
              store.get('last.clandestine-port')
            : 'Fetching your public IP',
        function: async () => {
          if (store.get('last.neighborhoodMode') == 'standard') {
            await shutdown(true);
            const setupValues = [
              {
                name: 'neighbors',
                value: store.get('last.neighbors') || setup.neighbors.value,
              },
              {
                name: 'neighborhood-mode',
                value: 'standard',
              },
              {
                name: 'dns-servers',
                value:
                  store.get('last.dnsAddress') || setup['dns-servers'].value,
              },
              {
                name: 'clandestine-port',
                value:
                  store.get('last.clandestine-port') ||
                  setup['clandestine-port'].value,
              },
              {
                name: 'ip',
                value: null,
              },
            ];

            if (!(await modifySetup(setupValues))) return;

            await startNode();

            await Utils.awaitSleep(20 * 1000);

            const websocketOpen = await isWebsocketOpen(); // testing if nodeWebsockets connection is still open. If automap fails connection will die
            automapFlag = websocketOpen;
          }
          if (automapFlag) {
            return true;
          } else {
            if (store.get('last.neighborhoodMode') == 'standard') {
              steps[0].label =
                'Port-forward failed, starting in Consume-Only Mode';
              await shutdown(true);
              await modifySetup([
                {
                  name: 'neighbors',
                  value: null,
                },
                {
                  name: 'neighborhood-mode',
                  value: 'zero-hop',
                },
                {
                  name: 'dns-servers',
                  value: null,
                },
              ]);
            }
            myPublicIP = await getMyPublicIP();
            if (!myPublicIP) {
              return false;
            }
            return true;
          }
        },
      });

      steps.push({
        label: t('Dashboard.CONNECT TO POLYGON'),
        function: async () => {
          const rpcEndpoint = setup['blockchain-service-url'].value;
          const pingSuccess = await Utils.pingESP(rpcEndpoint);
          if (!pingSuccess) {
            return false;
          }
          return true;
        },
      });

      steps.push({
        label: t('Dashboard.CONNECT TO NODE BACKEND'),

        function: async () => {
          if (automapFlag) {
            return true;
          }
          let setupValues = [
            {
              name: 'neighbors',
              value: store.get('last.neighbors') || setup.neighbors.value,
            },
            {
              name: 'chain',
              value: store.get('last.chain'),
            },
            {
              name: 'neighborhood-mode',
              value: 'consume-only',
            },
            {
              name: 'blockchain-service-url',
              value: store.get('last.blockchain-service-url'),
            },
            {
              name: 'ip',
              value: myPublicIP,
            },
            {
              name: 'dns-servers',
              value: null,
            },
            {
              name: 'clandestine-port',
              value: store.get('last.clandestine-port'),
            },
          ];

          await shutdown(true);
          const changedSuccess = await modifySetup(setupValues);
          if (!changedSuccess) {
            await modifySetup([
              {
                name: 'neighbors',
                value: null,
              },
            ]);
            return false;
          }
          const startedSuccess = await startNode();
          if (!startedSuccess) {
            return false;
          }
          return true;
        },
      });

      steps.push({
        label: t(
          'Dashboard.CONNECT TO MASQ NETWORK NEIGHBORHOOD THROUGH THE ENTRY NODE'
        ),
        function: async () => {
          if (!nodeRunning) {
            await startNode();
          }
          await Utils.awaitSleep(5 * 1000);

          const countryCode = await Utils.getCountryCodeByIp();

          if (countryCode) {
            dispatch(setCountryCode(countryCode));
            store.set(
              'last.blockchain-service-url',
              setup['blockchain-service-url'].value
            );
            store.set('last.chain', setup['chain'].value);
            store.set(
              'last.neighborhoodMode',
              automapFlag ? 'standard' : 'consume-only'
            );
            store.set('last.clandestine-port', PortNumber);
            dispatch(setSwitchServing(automapFlag));

            return true;
          } else {
            await shutdown(true);
            return false;
          }
        },
      });

      setRestartingSteps(steps);

      setRestartingModalOpen(true);
    } else {
      await shutdown(true);
      const setupValues = [
        {
          name: 'clandestine-port',
          value: store.get('last.clandestine-port'),
        },
      ];
      if (!(await modifySetup(setupValues))) return;
      handleClose();
    }
  };

  //  restarting node modal
  const handleRestartingModalClose = () => {
    setRestartingModalOpen(false);
  };
  const handleRestartingModalSubmit = () => {
    handleRestartingModalClose();
    handleSubmit();
  };

  return (
    <div>
      <Modal
        isOpen={isOpen}
        onRequestClose={handleClose}
        contentLabel="Port Number Modal"
        className="PortNumberModal"
        overlayClassName="Overlay"
        shouldCloseOnOverlayClick={shouldCloseOnOverlayClick}
        ariaHideApp={false}
        closeTimeoutMS={200}
      >
        <div className="close-button" onClick={handleClose} aria-hidden="true">
          <img src={closeIcon} alt="close modal" />
        </div>
        <div className="PortNumberModal__container">
          <div className="PortNumberModal__header">
            <img src={codeRect} alt="codeRect" />
            <div>
              <p className="title">
                {t('Dashboard.Set a Port Number to Open and Serve through')}
              </p>
              <p className="sub-title">
                {t(
                  'Dashboard.This is the port number that MASQ will try to open so that you can serve traffic to others through it. If you have a port number you prefer, you can enter it here'
                )}
                .
              </p>
            </div>
          </div>
          <div className="PortNumberModal__body">
            <div className="PortNumberForm">
              <label
                htmlFor="port-number"
                className="d-flex align-items-center mt-4"
              >
                <span>{t('Dashboard.Port Number')} </span>
              </label>
              <div className="PortNumberInputBox">
                <input
                  id="port-number"
                  name="port-number"
                  type="number"
                  onChange={(e) => {
                    setPortNumber(e.target.value);
                    store.set('last.clandestine-port', e.target.value);
                    setup['clandestine-port'].value = e.target.value;
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirm();
                    } else {
                      setPortNumber(e.target.value);
                    }
                  }}
                  value={PortNumber}
                />
              </div>
            </div>

            <div className="PortNumberCaution d-flex align-items-start mt-5 opacity-75">
              <img src={WarningIcon} alt="warning" />
              <p className="yellow_text">
                {t(
                  'Dashboard.Changing your port number will restart your node and have a negative impact on your node reputation temporarily. This can effect your nodes performance'
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="PortNumberModal__footer">
          <button
            className={classNames(
              'PortNumberModal__btn',
              'PortNumberModal__btn--inactive'
            )}
            onClick={handleConfirm}
          >
            {nodeRunning
              ? t('Dashboard.RESTART NODE & CHANGE SETTINGS')
              : t('Dashboard.CHANGE SETTINGS')}
          </button>
          <button
            className={classNames(
              'PortNumberModal__btn',
              'PortNumberModal__btn--active'
            )}
            onClick={handleClose}
          >
            {t('Dashboard.CANCEL AND GO BAC')}
          </button>
        </div>
      </Modal>
      <RestartingModal
        title={t('Dashboard.Connecting to MASQ Network')}
        steps={restartingSteps}
        isOpen={restartingModalOpen}
        handleClose={handleRestartingModalClose}
        handleSubmit={handleRestartingModalSubmit}
        shouldCloseOnOverlayClick={true}
      />
    </div>
  );
};

export default PortNumberModal;
